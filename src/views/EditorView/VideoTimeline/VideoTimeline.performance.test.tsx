import React from 'react';
import {act, fireEvent, render} from '@testing-library/react';
import {VideoTimeline} from './VideoTimeline';
import {Language} from '../../../data/LanguageConfig';

jest.mock('../../../index', () => ({store: {dispatch: jest.fn()}}));

describe('timeline drawing', () => {
    const context = {
        clearRect: jest.fn(), fillRect: jest.fn(), drawImage: jest.fn(),
        beginPath: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(),
        closePath: jest.fn(), fill: jest.fn(), fillText: jest.fn(), setLineDash: jest.fn(),
    };
    const props = {
        duration: 10, currentTime: 0, frames: 300, currentFrame: 0, fps: 30,
        annotatedFrames: [1, 5, 42], keyframes: [0], onFrameChange: jest.fn(), language: Language.ENGLISH,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
        jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 60, width: 900, height: 60, toJSON: () => ({})});
    });
    afterEach(() => jest.restoreAllMocks());

    it('reuses markers and canvas dimensions while playback advances', () => {
        const {rerender, container} = render(<VideoTimeline {...props}/>);
        const canvas = container.querySelector('canvas');
        const widthSetter = jest.spyOn(canvas, 'width', 'set');
        context.fillRect.mockClear();
        rerender(<VideoTimeline {...props} currentFrame={42} currentTime={1.4}/>);

        expect(widthSetter).not.toHaveBeenCalled();
        expect(context.fillRect).toHaveBeenCalledTimes(1);
        expect(context.drawImage).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), 0, 0);
        fireEvent.keyDown(window, {key: 'ArrowRight'});
        expect(props.onFrameChange).toHaveBeenLastCalledWith(43);
    });

    it('refreshes markers after annotation changes and handles a single frame', () => {
        const {rerender} = render(<VideoTimeline {...props}/>);
        context.fillRect.mockClear();
        rerender(<VideoTimeline {...props} annotatedFrames={[1, 5, 42, 60]}/>);
        expect(context.fillRect.mock.calls.length).toBeGreaterThan(1);
        context.fillRect.mockClear();
        rerender(<VideoTimeline {...props} duration={0} frames={1}/>);
        context.fillRect.mock.calls.forEach(call => expect(call.every(Number.isFinite)).toBe(true));
    });

    it('centers hover labels when the static layer is reused', () => {
        const alignments: string[] = [];
        context.fillText.mockImplementation((text: string) => {
            if (text.includes('(Frame')) alignments.push(Reflect.get(context, 'textAlign'));
        });
        const {container} = render(<VideoTimeline {...props}/>);
        fireEvent.mouseMove(container.querySelector('canvas'), {clientX: 100});
        fireEvent.mouseMove(container.querySelector('canvas'), {clientX: 200});
        expect(alignments).toEqual(['center', 'center']);
    });

    it('coalesces drag moves and commits the release position without waiting for a paint', () => {
        const callbacks: FrameRequestCallback[] = [];
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => callbacks.push(callback));
        const cancel = jest.spyOn(window, 'cancelAnimationFrame');
        const {container} = render(<VideoTimeline {...props}/>);
        const canvas = container.querySelector('canvas');
        fireEvent.mouseDown(canvas, {clientX: 90});
        expect(props.onFrameChange).toHaveBeenLastCalledWith(30);
        props.onFrameChange.mockClear();
        fireEvent.mouseMove(canvas, {clientX: 180});
        fireEvent.mouseMove(canvas, {clientX: 270});
        expect(props.onFrameChange).not.toHaveBeenCalled();
        expect(callbacks).toHaveLength(1);
        act(() => callbacks[0](0));
        expect(props.onFrameChange).toHaveBeenCalledTimes(1);
        expect(props.onFrameChange).toHaveBeenLastCalledWith(90);
        fireEvent.mouseMove(canvas, {clientX: 360});
        fireEvent.mouseUp(canvas, {clientX: 450});
        expect(props.onFrameChange).toHaveBeenLastCalledWith(150);
        expect(cancel).toHaveBeenLastCalledWith(2);
        act(() => callbacks[1](0));
        expect(props.onFrameChange).toHaveBeenCalledTimes(2);
    });

    it('flushes when leaving the timeline and cancels queued seeks on unmount', () => {
        const callbacks: FrameRequestCallback[] = [];
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => callbacks.push(callback));
        const cancel = jest.spyOn(window, 'cancelAnimationFrame');
        const {container, unmount} = render(<VideoTimeline {...props}/>);
        const canvas = container.querySelector('canvas');
        fireEvent.mouseDown(canvas, {clientX: 0});
        fireEvent.mouseMove(canvas, {clientX: 180});
        fireEvent.mouseLeave(canvas);
        expect(props.onFrameChange).toHaveBeenLastCalledWith(60);
        fireEvent.mouseDown(canvas, {clientX: 0});
        fireEvent.mouseMove(canvas, {clientX: 360});
        props.onFrameChange.mockClear();
        unmount();
        expect(cancel).toHaveBeenLastCalledWith(2);
        expect(props.onFrameChange).not.toHaveBeenCalled();
    });

    it('drops a pending move when dragging back to the current frame and preserves Shift selection', () => {
        const callbacks: FrameRequestCallback[] = [];
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => callbacks.push(callback));
        jest.spyOn(window, 'cancelAnimationFrame');
        const {container} = render(<VideoTimeline {...props}/>);
        const canvas = container.querySelector('canvas');
        fireEvent.mouseDown(canvas, {clientX: 0});
        fireEvent.mouseMove(canvas, {clientX: 180});
        fireEvent.mouseMove(canvas, {clientX: 0});
        act(() => callbacks[0](0));
        expect(props.onFrameChange).not.toHaveBeenCalled();
        fireEvent.mouseUp(canvas, {clientX: 0});
        fireEvent.mouseDown(canvas, {clientX: 180, shiftKey: true});
        fireEvent.mouseMove(canvas, {clientX: 360});
        fireEvent.mouseUp(canvas, {clientX: 360});
        expect(props.onFrameChange).not.toHaveBeenCalled();
    });
});
