import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {ScriptInfo, ScriptStore, fetchScripts, uploadScript, deleteScript} from '../../../../ai/ScriptStore';
import {ScriptSection} from '../ScriptSection';

jest.mock('../../../../ai/ScriptStore', () => ({
    ...jest.requireActual('../../../../ai/ScriptStore'),
    fetchScripts: jest.fn(),
    uploadScript: jest.fn(),
    deleteScript: jest.fn(),
}));

const fetchList = fetchScripts as jest.MockedFunction<typeof fetchScripts>;
const upload = uploadScript as jest.MockedFunction<typeof uploadScript>;
const remove = deleteScript as jest.MockedFunction<typeof deleteScript>;
const scripts: ScriptInfo[] = [
    {name: 'prepare', has_preprocess: true, has_postprocess: false, size: 10, mtime: 1},
    {name: 'finish', has_preprocess: false, has_postprocess: true, size: 10, mtime: 1},
    {name: 'both', has_preprocess: true, has_postprocess: true, size: 10, mtime: 1},
];

beforeEach(() => {
    jest.resetAllMocks();
    fetchList.mockResolvedValue(scripts);
    upload.mockResolvedValue('new');
    remove.mockResolvedValue(undefined);
    ScriptStore.set({preprocess: '', postprocess: 'finish', params: '{"threshold":0.4}'});
});

afterEach(() => jest.restoreAllMocks());

it('filters stage hooks and saves only valid JSON while retaining draft errors across collapse', async () => {
    render(<ScriptSection stage='preprocess' zh={false}/>);
    fireEvent.click(screen.getByText('[ Custom ]'));
    const prepare = await screen.findByRole('radio', {name: 'prepare.py'});
    expect(screen.queryByRole('radio', {name: 'finish.py'})).not.toBeInTheDocument();
    fireEvent.click(prepare);
    expect(ScriptStore.get()).toMatchObject({preprocess: 'prepare', postprocess: 'finish'});

    fireEvent.change(screen.getByRole('textbox'), {target: {value: '[1,2]'}});
    expect(screen.getByText('JSON: must be a JSON object')).toBeInTheDocument();
    expect(ScriptStore.get().params).toBe('{"threshold":0.4}');
    fireEvent.click(screen.getByText('[ Custom ]'));
    fireEvent.click(screen.getByText('[ Custom ]'));
    expect(screen.getByRole('textbox')).toHaveValue('[1,2]');
    fireEvent.change(screen.getByRole('textbox'), {target: {value: '{"threshold":0.8}'}});
    expect(ScriptStore.parsedParams()).toEqual({threshold: 0.8});
    expect(screen.queryByText(/JSON:/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), {target: {value: '{bad'}});
    expect(ScriptStore.parsedParams()).toEqual({threshold: 0.8});
    expect(screen.getByText(/JSON:/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), {target: {value: '   '}});
    expect(ScriptStore.get().params).toBe('');
    expect(screen.queryByText(/JSON:/)).not.toBeInTheDocument();
});

it('shows upload failures and refreshes the stage list after retrying the same file', async () => {
    upload.mockRejectedValueOnce(new Error('Invalid script hook'));
    const {container} = render(<ScriptSection stage='preprocess' zh={false}/>);
    fireEvent.click(screen.getByText('[ Custom ]'));
    await screen.findByRole('radio', {name: 'prepare.py'});
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['def preprocess(image, params): return image'], 'new.py', {type: 'text/x-python'});
    fireEvent.change(input, {target: {files: [file]}});
    expect(await screen.findByText('⚠ Invalid script hook')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');

    fetchList.mockResolvedValue([...scripts, {name: 'new', has_preprocess: true, has_postprocess: false, size: file.size, mtime: 2}]);
    fireEvent.change(input, {target: {files: [file]}});
    expect(await screen.findByRole('radio', {name: 'new.py'})).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('⚠ Invalid script hook')).not.toBeInTheDocument();
});

it('preserves the active script on canceled or failed deletion and clears only this stage on success', async () => {
    ScriptStore.set({preprocess: 'both', postprocess: 'both'});
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ScriptSection stage='postprocess' zh/>);
    fireEvent.click(screen.getByText('[ 自定义 ]'));
    const both = await screen.findByRole('radio', {name: /both.py/});
    const deleteButton = both.closest('label')?.parentElement?.querySelector('button') as HTMLButtonElement;
    fireEvent.click(deleteButton);
    expect(remove).not.toHaveBeenCalled();
    expect(both).toBeChecked();

    confirm.mockReturnValue(true);
    remove.mockRejectedValueOnce(new Error('Permission denied'));
    fireEvent.click(deleteButton);
    expect(await screen.findByText('⚠ Permission denied')).toBeInTheDocument();
    expect(ScriptStore.get()).toMatchObject({preprocess: 'both', postprocess: 'both'});
    fetchList.mockResolvedValue(scripts.filter(script => script.name !== 'both'));
    fireEvent.click(deleteButton);
    await waitFor(() => expect(screen.queryByRole('radio', {name: /both.py/})).not.toBeInTheDocument());
    expect(ScriptStore.get()).toMatchObject({preprocess: 'both', postprocess: ''});
    expect(screen.getByRole('radio', {name: '不启用'})).toBeChecked();
    expect(remove).toHaveBeenLastCalledWith('both');
});
