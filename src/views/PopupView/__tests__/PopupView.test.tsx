import React from 'react';
import {fireEvent, render} from '@testing-library/react';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {PopupView} from '../PopupView';

jest.mock('../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));
jest.mock('../../../index', () => ({
    store: {getState: jest.fn(() => ({general: {language: 0}}))},
}));
jest.mock('../../../logic/helpers/CSSHelper', () => ({
    CSSHelper: {getLeadingColor: jest.fn(() => '#ffffff')},
}));

describe('PopupView dismissal', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => jest.restoreAllMocks());

    it('hides from the outer backdrop without unmounting and fully closes from Escape', () => {
        const close = jest.spyOn(PopupActions, 'close').mockImplementation(jest.fn());
        const view = render(<PopupView
            activePopupType={PopupWindowType.LOADER}
            activePopupNodeId={null}
            activePopupNodeName={null}
            activePopupNodeRemote={false}
        />);
        const {container} = view;
        const backdrop = container.querySelector('.PopupView') as HTMLElement;
        const content = backdrop.firstElementChild as HTMLElement;

        fireEvent.mouseDown(content);
        expect(close).not.toHaveBeenCalled();
        fireEvent.mouseDown(backdrop);
        expect(close).toHaveBeenCalledTimes(1);
        view.rerender(<PopupView
            activePopupType={null}
            activePopupNodeId={null}
            activePopupNodeName={null}
            activePopupNodeRemote={false}
        />);
        expect(backdrop).toHaveAttribute('hidden');
        expect(backdrop).toHaveStyle({display: 'none'});
        expect(backdrop.firstElementChild).toBe(content);

        view.rerender(<PopupView
            activePopupType={PopupWindowType.LOADER}
            activePopupNodeId={null}
            activePopupNodeName={null}
            activePopupNodeRemote={false}
        />);
        expect(backdrop).not.toHaveAttribute('hidden');
        expect(backdrop.firstElementChild).toBe(content);
        fireEvent.keyDown(window, {key: 'Escape'});
        expect(close).toHaveBeenCalledTimes(2);
        view.rerender(<PopupView
            activePopupType={null}
            activePopupNodeId={null}
            activePopupNodeName={null}
            activePopupNodeRemote={false}
        />);
        expect(container.querySelector('.PopupView')).toBeNull();
    });

    it('treats marked custom backdrops as outside without hiding for portal content', () => {
        const close = jest.spyOn(PopupActions, 'close').mockImplementation(jest.fn());
        const {container} = render(<PopupView
            activePopupType={PopupWindowType.LOADER}
            activePopupNodeId={null}
            activePopupNodeName={null}
            activePopupNodeRemote={false}
        />);
        const backdrop = container.querySelector('.PopupView') as HTMLElement;
        const customBackdrop = document.createElement('div');
        customBackdrop.setAttribute('data-popup-backdrop', '');
        backdrop.appendChild(customBackdrop);
        const portalContent = document.createElement('div');
        backdrop.appendChild(portalContent);

        fireEvent.mouseDown(portalContent);
        expect(close).not.toHaveBeenCalled();
        fireEvent.mouseDown(customBackdrop);
        expect(close).toHaveBeenCalledTimes(1);
    });
});
