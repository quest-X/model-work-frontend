import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {QueueItem} from '../../../../store/queue/types';
import {CanvasMultiViewStore} from '../../MultiView/CanvasMultiViewStore';
import CameraPlayer from '../CameraPlayer';

jest.mock('../../../../services/CameraResourceService', () => ({
    CameraResourceService: {
        streamUrl: (_resourceId: string, _channelId: string, nonce: number, branch: string) => `http://camera.test/live?branch=${branch}&nonce=${nonce}`,
    },
}));

jest.mock('../../../../services/CameraPreviewService', () => ({
    CameraPreviewService: {get: () => new Promise(() => undefined)},
}));

jest.mock('../../../../services/CameraParameterService', () => ({
    CameraParameterService: {
        compare: () => new Promise(() => undefined),
    },
}));

describe('CameraPlayer', () => {
    const drawImage = jest.fn();
    const context = {
        beginPath: jest.fn(),
        clearRect: jest.fn(),
        closePath: jest.fn(),
        drawImage,
        fill: jest.fn(),
        fillRect: jest.fn(),
        fillText: jest.fn(),
        lineTo: jest.fn(),
        moveTo: jest.fn(),
        stroke: jest.fn(),
        fillStyle: '',
        font: '',
        lineWidth: 1,
        strokeStyle: '',
        textAlign: 'start',
    } as unknown as CanvasRenderingContext2D;
    const item = {
        id: 'camera-resource-1',
        name: 'Camera 01',
        cameraResourceId: 'resource-1',
        cameraChannelId: '102',
        cameraHost: '192.168.10.12',
        cameraModel: 'DS-2CD2686FWDA2-IZS',
    } as QueueItem;

    beforeEach(() => {
        act(() => CanvasMultiViewStore.setLayout('1x1'));
        drawImage.mockClear();
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    });

    afterEach(() => {
        act(() => CanvasMultiViewStore.setLayout('1x1'));
        jest.restoreAllMocks();
    });

    it('shows the camera IP beside the live status without repeating it in metadata', () => {
        const {container} = render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        expect(container.querySelector('.CameraPlayerIdentity strong')).toHaveTextContent('192.168.10.12');
        expect(container.querySelector('.CameraPlayerIdentity strong')).not.toHaveTextContent('Camera 01');
        expect(container.querySelector('.CameraPlayerMeta')).not.toHaveTextContent('192.168.10.12');
        expect(container.querySelector('.CameraPlayerMeta')).toHaveTextContent('DS-2CD2686FWDA2-IZS');
    });

    it('waits for the remote first frame, times out and reconnects with a fresh stream URL', () => {
        jest.useFakeTimers();
        try {
            const {unmount} = render(<CameraPlayer item={{...item, cameraNodeId: 'node-1'}} language={Language.CHINESE}/>);
            const image = () => screen.getByAltText('Camera 01 实时画面');
            const original = image();
            const originalUrl = original.getAttribute('src');
            act(() => { jest.advanceTimersByTime(12_000); });
            expect(screen.getByText('等待首帧超时')).toBeInTheDocument();
            expect(screen.queryByAltText('Camera 01 实时画面')).not.toBeInTheDocument();
            expect(original).not.toHaveAttribute('src');

            fireEvent.click(screen.getByRole('button', {name: '重新连接'}));
            expect(image().getAttribute('src')).not.toBe(originalUrl);
            fireEvent.load(image());
            expect(screen.getByText('LIVE')).toBeInTheDocument();
            act(() => { jest.advanceTimersByTime(13_000); });
            expect(screen.queryByText('等待首帧超时')).not.toBeInTheDocument();
            fireEvent.error(image());
            expect(screen.getByText('实时画面连接失败')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', {name: '重新连接'}));
            const reconnected = image();
            unmount();
            expect(reconnected).not.toHaveAttribute('src');
        } finally {
            jest.useRealTimers();
        }
    });

    it('uses Smart controls as a panel launcher and closes it from outside', () => {
        const {container} = render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        const openButton = screen.getByRole('button', {name: '智能调参'});
        expect(openButton).toHaveAttribute('aria-expanded', 'false');
        expect(container.querySelector('#camera-smart-controls')).not.toBeInTheDocument();

        fireEvent.click(openButton);
        expect(openButton).toHaveAttribute('aria-expanded', 'true');
        expect(container.querySelector('#camera-smart-controls')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '关闭相机控制'})).not.toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        expect(openButton).toHaveAttribute('aria-expanded', 'false');
        expect(container.querySelector('#camera-smart-controls')).not.toBeInTheDocument();
    });

    it('opens the camera parameter comparison and closes smart controls', () => {
        const {container} = render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        fireEvent.click(screen.getByRole('button', {name: '智能调参'}));
        expect(container.querySelector('#camera-smart-controls')).toBeInTheDocument();

        const parametersButton = screen.getByRole('button', {name: '相机参数'});
        expect(parametersButton).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(parametersButton);

        expect(container.querySelector('#camera-smart-controls')).not.toBeInTheDocument();
        expect(parametersButton).toHaveAttribute('aria-expanded', 'true');
        expect(container.querySelector('#camera-parameters-panel')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '关闭相机参数'})).not.toBeInTheDocument();

        fireEvent.keyDown(window, {key: 'Escape'});
        expect(parametersButton).toHaveAttribute('aria-expanded', 'false');
        expect(container.querySelector('#camera-parameters-panel')).not.toBeInTheDocument();
    });

    it('shows two independent LIVE logical branches in comparison mode', () => {
        act(() => CanvasMultiViewStore.setLayout('1x2'));
        render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        expect(screen.getByText('原始画面')).toBeInTheDocument();
        expect(screen.getByText('调参效果')).toBeInTheDocument();
        expect(screen.getByText('1011 · LIVE')).toBeInTheDocument();
        expect(screen.getByText('1012 · LIVE')).toBeInTheDocument();
        expect(screen.getByRole('img', {name: 'Camera 01 原始实时画面'})).toHaveAttribute('src', expect.stringContaining('branch=original'));
        expect(screen.getByRole('img', {name: 'Camera 01 调参效果画面'})).toHaveAttribute('src', expect.stringContaining('branch=adjusted'));
        expect(screen.getByText('正在建立原始画面…')).toBeInTheDocument();
        expect(screen.getByText('正在建立调参画面…')).toBeInTheDocument();
        expect(screen.queryByText('已锁定')).not.toBeInTheDocument();
        expect(drawImage).not.toHaveBeenCalled();

        fireEvent.load(screen.getByRole('img', {name: 'Camera 01 原始实时画面'}));
        expect(screen.queryByText('正在建立原始画面…')).not.toBeInTheDocument();
        expect(screen.getByText('正在建立调参画面…')).toBeInTheDocument();

        fireEvent.load(screen.getByRole('img', {name: 'Camera 01 调参效果画面'}));
        expect(screen.queryByText('正在建立调参画面…')).not.toBeInTheDocument();
    });

    it('reports original and adjusted stream failures independently', () => {
        act(() => CanvasMultiViewStore.setLayout('1x2'));
        render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        fireEvent.error(screen.getByRole('img', {name: 'Camera 01 原始实时画面'}));
        expect(screen.getByText('原始画面连接失败')).toBeInTheDocument();
        expect(screen.getByText('正在建立调参画面…')).toBeInTheDocument();

        fireEvent.error(screen.getByRole('img', {name: 'Camera 01 调参效果画面'}));
        expect(screen.getByText('调参画面连接失败')).toBeInTheDocument();
    });

    it('freezes the current frame on pause and reconnects to the latest frame on resume', () => {
        render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        const liveImage = screen.getByRole('img', {name: 'Camera 01 实时画面'});
        Object.defineProperty(liveImage, 'naturalWidth', {configurable: true, value: 640});
        Object.defineProperty(liveImage, 'naturalHeight', {configurable: true, value: 360});
        fireEvent.load(liveImage);

        fireEvent.click(screen.getByRole('button', {name: /暂停/}));
        expect(drawImage).toHaveBeenCalledWith(liveImage, 0, 0, 640, 360);
        expect(screen.queryByRole('img', {name: 'Camera 01 实时画面'})).not.toBeInTheDocument();
        expect(screen.getByLabelText('Camera 01 暂停画面')).toHaveClass('visible');
        expect(screen.getByText('已暂停')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: /播放/}));
        expect(screen.getByRole('img', {name: 'Camera 01 实时画面'})).toBeInTheDocument();
        expect(screen.getByText('连接中')).toBeInTheDocument();
        expect(screen.getByLabelText('相机直播进度条')).toHaveAttribute('height', '80');
    });

    it('keeps playback disabled until the first live frame loads', () => {
        render(<CameraPlayer item={item} language={Language.CHINESE}/>);
        expect(screen.getByRole('button', {name: /播放/})).toBeDisabled();
    });
    it('resets paused comparison playback and hides local controls when switching to a remote camera', () => {
        act(() => CanvasMultiViewStore.setLayout('1x2'));
        const {rerender} = render(<CameraPlayer item={item} language={Language.ENGLISH}/>);
        const original = screen.getByRole('img', {name: 'Camera 01 original live stream'});
        const adjusted = screen.getByRole('img', {name: 'Camera 01 adjusted live stream'});
        const previousUrl = adjusted.getAttribute('src');
        for (const image of [original, adjusted]) {
            Object.defineProperty(image, 'naturalWidth', {configurable: true, value: 640});
            Object.defineProperty(image, 'naturalHeight', {configurable: true, value: 360});
            fireEvent.load(image);
        }
        fireEvent.keyDown(window, {code: 'Space'});
        expect(drawImage).toHaveBeenCalledWith(original, 0, 0, 640, 360);
        expect(drawImage).toHaveBeenCalledWith(adjusted, 0, 0, 640, 360);
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Smart controls'}));

        rerender(<CameraPlayer
            item={{...item, name: 'Remote camera', cameraResourceId: 'resource-2', cameraNodeId: 'node-2'}}
            language={Language.ENGLISH}
        />);

        expect(screen.getByRole('img', {name: 'Remote camera live stream'})).not.toHaveAttribute('src', previousUrl);
        expect(screen.queryByRole('img', {name: /original live stream/})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Smart controls'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Camera parameters'})).not.toBeInTheDocument();
        expect(screen.queryByText('Preview not dispatched')).not.toBeInTheDocument();
        expect(screen.getByText('CONNECTING')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /Play/})).toBeDisabled();
    });

});
