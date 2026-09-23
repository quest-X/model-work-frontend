import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import Hls from 'hls.js';
import {ProgramLivePreview} from '../ProgramLivePreview';

jest.mock('hls.js', () => {
    const instance = {
        on: jest.fn(), loadSource: jest.fn(), attachMedia: jest.fn(), destroy: jest.fn(),
    };
    return {
        __esModule: true,
        default: Object.assign(jest.fn(() => instance), {
            isSupported: () => true, Events: {ERROR: 'error'},
        }),
    };
});
jest.mock('../../EditorView/CameraTimeline/CameraTimeline', () => ({
    __esModule: true, default: () => <div aria-label='全天直播时间轴'/>,
}));

const originalFetch = global.fetch;

beforeEach(() => {
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.clearAllMocks();
});

it('switches actual HLS modes, releases readers, and never labels external playback LIVE', async () => {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
            schema_version: 'program.media.trial.v1',
            protocols: ['mjpeg', 'hls', 'llhls', 'webrtc', 'rtsp', 'srt'],
        }),
    });
    const close = jest.fn();
    window.MediaMTXWebRTCReader = jest.fn(() => ({close}));
    const {container, unmount} = render(<ProgramLivePreview
        nodeId='node03' programId='dlk-overflow' name='DLK' path='/stream.mjpeg' zh
    />);
    const select = await screen.findByRole('combobox', {name: '播放协议'});
    expect(screen.getAllByRole('option')).toHaveLength(6);
    expect(screen.getByRole('img').getAttribute('src')).toContain('path=%2Fstream.mjpeg');
    fireEvent.change(select, {target: {value: 'hls'}});
    expect(Hls).toHaveBeenLastCalledWith({lowLatencyMode: false});
    const hls = (Hls as unknown as jest.Mock).mock.results[0].value;
    expect(hls.loadSource).toHaveBeenLastCalledWith(expect.stringContaining('/media/hls/index.m3u8'));
    expect(screen.getByText('连接中')).toBeTruthy();
    fireEvent.playing(container.querySelector('video'));
    expect(screen.getByText('LIVE')).toBeTruthy();
    fireEvent.change(select, {target: {value: 'llhls'}});
    expect(hls.destroy).toHaveBeenCalled();
    expect(Hls).toHaveBeenLastCalledWith({lowLatencyMode: true});
    fireEvent.change(select, {target: {value: 'webrtc'}});
    expect(window.MediaMTXWebRTCReader).toHaveBeenCalledWith(expect.objectContaining({
        url: expect.stringContaining('/media/webrtc/whep'),
    }));
    fireEvent.change(select, {target: {value: 'srt'}});
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.getByText('外部播放')).toBeTruthy();
    expect(screen.queryByText('LIVE')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
    global.fetch = jest.fn().mockResolvedValue({
        ok: true, json: async () => ({url: 'srt://example:8890?streamid=read:test'}),
    });
    fireEvent.click(screen.getByRole('button', {name: '获取播放地址'}));
    await waitFor(() => expect(screen.getByRole('textbox').getAttribute('value')).toContain('srt://'));
    unmount();
});

it('preserves MJPEG when a node has no media trial', async () => {
    global.fetch = jest.fn().mockResolvedValue({ok: false, status: 404});
    render(<ProgramLivePreview nodeId='other' programId='dlk' name='DLK' path='/stream.mjpeg' zh/>);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('连接失败')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: '重试'}));
    expect(screen.getByText('连接中')).toBeTruthy();
});

it.each(['mjpeg', 'hls', 'llhls', 'webrtc'])('releases hidden %s previews and reconnects on return', async protocol => {
    const hidden = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    global.fetch = jest.fn().mockResolvedValue({
        ok: true, json: async () => ({
            schema_version: 'program.media.trial.v1', protocols: ['mjpeg', 'hls', 'llhls', 'webrtc'],
        }),
    });
    const close = jest.fn();
    window.MediaMTXWebRTCReader = jest.fn(() => ({close}));
    const {container, unmount} = render(<ProgramLivePreview
        nodeId='node04' programId='dlk-overflow' name='DLK' path='/stream.mjpeg' zh
    />);
    const select = await screen.findByRole('combobox');
    const image = screen.getByRole('img');
    fireEvent.change(select, {target: {value: protocol}});
    if (protocol !== 'mjpeg') expect(image.hasAttribute('src')).toBe(false);
    const hls = (Hls as unknown as jest.Mock).mock.results.at(-1)?.value;
    const instances = (Hls as unknown as jest.Mock).mock.calls.length;
    hidden.mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(container.querySelector('img, video')).toBeNull();
    expect(image.hasAttribute('src')).toBe(false);
    if (hls) expect(hls.destroy).toHaveBeenCalled();
    if (protocol === 'webrtc') expect(close).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    expect(container.querySelector(protocol === 'mjpeg' ? 'img' : 'video')).not.toBeNull();
    expect(screen.getByText('连接中')).toBeTruthy();
    if (hls) expect(Hls).toHaveBeenCalledTimes(instances + 1);
    if (protocol === 'webrtc') expect(window.MediaMTXWebRTCReader).toHaveBeenCalledTimes(2);
    const resumedImage = container.querySelector('img');
    unmount();
    if (resumedImage) expect(resumedImage.hasAttribute('src')).toBe(false);
});

it('does not open a media connection when initially hidden', () => {
    jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    global.fetch = jest.fn().mockResolvedValue({ok: false});
    const {container} = render(<ProgramLivePreview
        nodeId='node04' programId='dlk-overflow' name='DLK' path='/stream.mjpeg' zh
    />);
    expect(container.querySelector('img, video')).toBeNull();
    expect(Hls).not.toHaveBeenCalled();
});

it('restores the MJPEG source on effect replay and language changes', () => {
    global.fetch = jest.fn().mockResolvedValue({ok: false});
    const preview = (zh: boolean) => <React.StrictMode><ProgramLivePreview
        nodeId='node04' programId='dlk-overflow' name='DLK' path='/stream.mjpeg' zh={zh}
    /></React.StrictMode>;
    const {rerender, unmount} = render(preview(true));
    expect(screen.getByRole('img').getAttribute('src')).toContain('path=%2Fstream.mjpeg');
    rerender(preview(false));
    const image = screen.getByRole('img');
    expect(image.getAttribute('src')).toContain('path=%2Fstream.mjpeg');
    unmount();
    expect(image.hasAttribute('src')).toBe(false);
});

it('allows a slow LL-HLS first frame, then detects an established stream stall', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
        ok: true, json: async () => ({
            schema_version: 'program.media.trial.v1', protocols: ['mjpeg', 'llhls'],
        }),
    });
    const {container} = render(<ProgramLivePreview
        nodeId='node04' programId='dlk-overflow' name='DLK' path='/stream.mjpeg' zh
    />);
    fireEvent.change(await screen.findByRole('combobox'), {target: {value: 'llhls'}});
    const hls = (Hls as unknown as jest.Mock).mock.results[0].value;
    let frames = 0;
    Object.defineProperty(container.querySelector('video'), 'getVideoPlaybackQuality', {
        value: () => ({totalVideoFrames: frames}),
    });
    act(() => { jest.advanceTimersByTime(25000); });
    expect(screen.getByText('连接中')).toBeTruthy();
    expect(screen.queryByText('LIVE')).toBeNull();
    frames = 1;
    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText('LIVE')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(21000); });
    expect(screen.getByText('20 秒内未收到新视频帧')).toBeTruthy();
    expect(hls.destroy).toHaveBeenCalledTimes(1);
});

it('bounds LL-HLS first-frame loading at 30 seconds', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
        ok: true, json: async () => ({
            schema_version: 'program.media.trial.v1', protocols: ['mjpeg', 'llhls'],
        }),
    });
    render(<ProgramLivePreview nodeId='node04' programId='dlk' name='DLK' path='/stream.mjpeg' zh/>);
    fireEvent.change(await screen.findByRole('combobox'), {target: {value: 'llhls'}});
    const hls = (Hls as unknown as jest.Mock).mock.results[0].value;
    act(() => { jest.advanceTimersByTime(30000); });
    expect(screen.getByText('连接中')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText('实时画面首帧加载超时')).toBeTruthy();
    expect(hls.destroy).toHaveBeenCalledTimes(1);
});
