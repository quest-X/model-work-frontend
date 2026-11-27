import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import SigineInfraChoice from '../SigineInfraChoice';
import {getSigineSelection, modelSourceLabel, updateSigineSelection} from '../../../utils/SigineInfra';

const originalFetch = global.fetch;
const sources = [
    {id: 'account-a', label: 'Account A · OpenAI Plus', scope: 'online', models: [{id: 'vision', available: true}]},
    {id: 'account-b', label: 'Account B · OpenAI Pro', scope: 'online', models: [{id: 'vision', available: true}]},
    {id: 'host', label: 'GPU · 192.168.10.166', scope: 'offline', models: [
        {id: 'MiniCPM', available: true}, {id: 'unloaded', available: false},
    ]},
];

beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn(async () => ({ok: true, json: async () => ({sources, model: 'vision'})} as Response));
});
afterEach(() => {global.fetch = originalFetch; localStorage.clear();});

it('groups Sigine sources and persists the exact source/model, including duplicate model IDs', async () => {
    const onCountChange = jest.fn();
    render(<SigineInfraChoice baseUrl='/core_service' zh onCountChange={onCountChange}/>);
    const account = await screen.findByText('Account B · OpenAI Pro');
    expect(account.closest('details').closest('details').parentElement.closest('details').querySelector('summary')).toHaveTextContent('在线');
    fireEvent.click(account.closest('details').querySelector('input'));
    expect(getSigineSelection()).toEqual({source_id: 'account-b', model: 'vision'});
    fireEvent.click(screen.getByLabelText('MiniCPM'));
    expect(getSigineSelection()).toEqual({source_id: 'host', model: 'MiniCPM'});
    expect(screen.getByLabelText('unloaded')).toBeDisabled();
    expect(screen.getByLabelText('MiniCPM')).toBeChecked();
    fireEvent.click(screen.getByLabelText('MiniCPM'));
    expect(localStorage.getItem('opensight.sigineInfra')).toBe('false');
    expect(onCountChange).toHaveBeenLastCalledWith(4);
    expect(onCountChange.mock.calls.map(([count]) => count)).toEqual([null, 4]);
});

it('synchronizes summary toggles without changing the saved source for duplicate model IDs', async () => {
    const onChange = jest.fn();
    render(<SigineInfraChoice baseUrl='/core_service' zh onChange={onChange}/>);
    const accountB = (await screen.findByText('Account B · OpenAI Pro')).closest('details').querySelector('input');
    const accountA = screen.getByText('Account A · OpenAI Plus').closest('details').querySelector('input');
    fireEvent.click(accountB);
    const selection = getSigineSelection();
    act(() => updateSigineSelection(false, selection));
    expect(accountB).not.toBeChecked();
    expect(onChange).toHaveBeenLastCalledWith('', selection);
    act(() => updateSigineSelection(true, selection));
    expect(accountB).toBeChecked();
    expect(accountA).not.toBeChecked();
    expect(getSigineSelection()).toEqual({source_id: 'account-b', model: 'vision'});
    expect(onChange).toHaveBeenLastCalledWith('vision', selection);
});

it('requires a new choice when the saved source was revoked instead of silently switching accounts', async () => {
    localStorage.setItem('opensight.sigineInfraSelection', JSON.stringify({source_id: 'revoked', model: 'vision'}));
    localStorage.setItem('opensight.sigineInfra', 'true');
    render(<SigineInfraChoice baseUrl='/core_service' zh/>);
    const account = await screen.findByText('Account A · OpenAI Plus');
    expect(getSigineSelection().source_id).toBe('revoked');
    await waitFor(() => expect(localStorage.getItem('opensight.sigineInfra')).toBeNull());
    fireEvent.click(account.closest('details').querySelector('input'));
    expect(getSigineSelection().source_id).toBe('account-a');
});

it('keeps the selection and disables inference when the catalog cannot be read', async () => {
    localStorage.setItem('opensight.sigineInfraSelection', JSON.stringify({source_id: 'host', model: 'MiniCPM'}));
    global.fetch = jest.fn(async () => ({ok: false, status: 502} as Response));
    const onCountChange = jest.fn();
    render(<SigineInfraChoice baseUrl='/core_service' zh={false} onCountChange={onCountChange}/>);
    await screen.findByText('Catalog failed; reopen to retry');
    expect(screen.queryByRole('checkbox', {hidden: true})).toBeNull();
    expect(getSigineSelection()).toEqual({source_id: 'host', model: 'MiniCPM'});
    expect(onCountChange).toHaveBeenLastCalledWith(null);
});

it('labels external model providers for annotation badges', () => {
    expect(modelSourceLabel('deepseek-v4.1-flash-1017')).toBe('DeepSeek');
    expect(modelSourceLabel('deepseek/deepseek-v4-flash-vision-exp')).toBe('DeepSeek');
    expect(modelSourceLabel('gpt-5.6-sol')).toBe('GPT');
    expect(modelSourceLabel('glm-5.3-flash')).toBe('GLM');
    expect(modelSourceLabel('kimi-k2.7-code')).toBe('Kimi');
    expect(modelSourceLabel('mimo-v2.6-pro')).toBe('MiMo');
    expect(modelSourceLabel('minimax-m3')).toBe('MiniMax');
    expect(modelSourceLabel('hy4')).toBe('Hunyuan');
    expect(modelSourceLabel('custom-model')).toBe('custom-model');
});
