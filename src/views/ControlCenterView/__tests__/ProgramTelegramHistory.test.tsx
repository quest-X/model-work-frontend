import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {ProgramTelegramHistory} from '../ProgramTelegramHistory';
import {readTelegramHistory, TelegramHistory} from '../../../services/ProgramTelegramHistory';

jest.mock('../../../services/ProgramTelegramHistory', () => ({
    ...jest.requireActual('../../../services/ProgramTelegramHistory'),
    readTelegramHistory: jest.fn(),
}));

const artifacts = ['a', 'b'].map(id => ({
    artifact_id: id.repeat(32), selection_id: `dlk:${id}`, program_id: 'dlk', program_name: 'DLK',
    name: 'ixcom.jsonl', relative_path: `runs/${id}/ixcom.jsonl`, kind: 'data' as const,
    size_bytes: 400000, content_type: 'application/x-ndjson', modified_at: 101,
}));
const history = (count: number, start = 0): TelegramHistory => ({
    start, size: 400000, pending: new Uint8Array(), invalid: [], otherLines: 0,
    records: Array.from({length: count}, (_, index) => ({
        byteOffset: start + index * 80,
        raw: `{ "src":"ixcom", "t":${index}.25, "frame_idx":${index}, "custom":"保留" }`,
        value: {src: 'ixcom', t: index + 0.25, frame_idx: index, custom: '保留'},
    })),
});
const read = jest.mocked(readTelegramHistory);
const props = {nodeId: 'node-a', artifacts, online: true, zh: true, pretty: false};

afterEach(() => jest.resetAllMocks());

it('loads older history, reports first/last fields and bad lines, and pages all records without changing raw text', async () => {
    const recent = history(2, 200000);
    const complete = {...history(205), invalid: [{raw: '{bad}', byteOffset: 399999}]};
    read.mockResolvedValueOnce(recent).mockResolvedValueOnce(complete);
    render(<ProgramTelegramHistory {...props} />);
    expect(await screen.findByText(/仅已加载部分历史/)).toHaveTextContent('电文 2 条');
    expect(screen.getAllByLabelText('电文内容')[0].textContent).toBe(recent.records[1].raw);
    fireEvent.click(screen.getByRole('button', {name: '加载更早'}));
    expect(await screen.findByText(/已读取至文件开头/)).toHaveTextContent('电文 205 条 · 坏行 1 条');
    expect(read.mock.calls[1][1]).toBe(recent);
    expect(screen.getByText(/frame_idx:/)).toHaveTextContent('frame_idx: 0 → 204 · 时间: 0.25 → 204.25');
    expect(screen.getAllByLabelText('电文内容')).toHaveLength(100);
    fireEvent.click(screen.getByRole('button', {name: '较早记录'}));
    fireEvent.click(screen.getByRole('button', {name: '较早记录'}));
    expect(screen.getAllByLabelText('电文内容')).toHaveLength(5);
    expect(screen.getAllByLabelText('电文内容')[4].textContent).toBe(complete.records[0].raw);
    expect(screen.getByRole('button', {name: '加载更早'})).toBeDisabled();
    expect(screen.getByText('{bad}')).toBeInTheDocument();
});

it('retains loaded records on failure and retries the same range; refresh replaces the snapshot', async () => {
    const recent = history(2, 200000);
    read.mockResolvedValueOnce(recent).mockRejectedValueOnce(new Error('HTTP 503'))
        .mockResolvedValueOnce(history(3)).mockResolvedValueOnce(history(1));
    render(<ProgramTelegramHistory {...props} />);
    await screen.findByText(/仅已加载部分历史/);
    fireEvent.click(screen.getByRole('button', {name: '加载更早'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503');
    expect(screen.getAllByLabelText('电文内容')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', {name: '加载更早'}));
    await screen.findByText(/电文 3 条/);
    expect(read.mock.calls[2][1]).toBe(recent);
    fireEvent.click(screen.getByRole('button', {name: '刷新文件'}));
    await screen.findByText(/电文 1 条/);
    expect(read.mock.calls[3][1]).toBeUndefined();
});

it('cancels reads when selecting another file and ignores late responses', async () => {
    let resolveFirst: (value: TelegramHistory) => void;
    read.mockImplementationOnce(() => new Promise(resolve => {resolveFirst = resolve;}))
        .mockResolvedValueOnce(history(1));
    const view = render(<ProgramTelegramHistory {...props} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const firstSignal = read.mock.calls[0][2];
    fireEvent.change(screen.getByRole('combobox', {name: '电文文件'}), {target: {value: artifacts[1].selection_id}});
    await screen.findByText(/电文 1 条/);
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => resolveFirst(history(9)));
    expect(screen.queryByText(/电文 9 条/)).not.toBeInTheDocument();
    const secondSignal = read.mock.calls[1][2];
    view.unmount();
    expect(secondSignal?.aborted).toBe(true);
});

it('aborts when offline, disables loading and clears old node contents on node change', async () => {
    read.mockResolvedValueOnce(history(2));
    const view = render(<ProgramTelegramHistory {...props} />);
    await screen.findByText(/电文 2 条/);
    const firstSignal = read.mock.calls[0][2];
    view.rerender(<ProgramTelegramHistory {...props} online={false} />);
    expect(firstSignal?.aborted).toBe(true);
    expect(screen.getByRole('button', {name: '刷新文件'})).toBeDisabled();
    view.rerender(<ProgramTelegramHistory {...props} nodeId='node-b' online={false} />);
    expect(screen.queryByLabelText('电文内容')).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
});
