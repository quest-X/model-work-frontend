import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
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

afterEach(() => {
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
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
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
