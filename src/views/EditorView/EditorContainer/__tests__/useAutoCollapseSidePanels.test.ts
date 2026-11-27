import {act, renderHook} from '@testing-library/react';
import {useState} from 'react';
import {Settings} from '../../../../settings/Settings';
import {
    measureEditorWidth,
    shouldAutoCollapseSidePanels,
    SidePanelOpenState,
    SIDE_PANEL_AUTO_COLLAPSE_MIN_EDITOR_WIDTH,
    SIDE_PANEL_AUTO_RESTORE_EDITOR_WIDTH,
    useAutoCollapseSidePanels,
} from '../useAutoCollapseSidePanels';

const OPEN = Settings.SIDE_NAVIGATION_BAR_WIDTH_OPEN_PX;
const CLOSED = Settings.SIDE_NAVIGATION_BAR_WIDTH_CLOSED_PX;
const BOTH_OPEN_OVERHEAD = OPEN + OPEN;

const useHarness = (windowWidth: number) => {
    const [panels, setPanels] = useState<SidePanelOpenState>({leftTabStatus: true, rightTabStatus: true});
    useAutoCollapseSidePanels(windowWidth, panels, (next) => setPanels(next));
    return {panels, setPanels};
};

const renderHarness = (windowWidth: number) => renderHook(
    ({width}) => useHarness(width),
    {initialProps: {width: windowWidth}},
);

describe('side panel auto collapse', () => {
    describe('measureEditorWidth', () => {
        it('subtracts both open panels', () => {
            expect(measureEditorWidth(1280, {leftTabStatus: true, rightTabStatus: true}))
                .toBe(1280 - OPEN - OPEN);
        });

        it('subtracts the companion bars when panels are closed', () => {
            expect(measureEditorWidth(1280, {leftTabStatus: false, rightTabStatus: false}))
                .toBe(1280 - CLOSED - CLOSED);
        });

        it('subtracts one open panel and one companion bar', () => {
            expect(measureEditorWidth(900, {leftTabStatus: true, rightTabStatus: false}))
                .toBe(900 - OPEN - CLOSED);
        });
    });

    describe('shouldAutoCollapseSidePanels', () => {
        it('collapses when the app starts with a squeezed canvas', () => {
            expect(shouldAutoCollapseSidePanels(null, SIDE_PANEL_AUTO_COLLAPSE_MIN_EDITOR_WIDTH - 1))
                .toBe(true);
        });

        it('keeps panels when the canvas starts usable', () => {
            expect(shouldAutoCollapseSidePanels(null, SIDE_PANEL_AUTO_COLLAPSE_MIN_EDITOR_WIDTH))
                .toBe(false);
        });

        it('collapses after the canvas crosses below the minimum', () => {
            expect(shouldAutoCollapseSidePanels(SIDE_PANEL_AUTO_COLLAPSE_MIN_EDITOR_WIDTH, 120))
                .toBe(true);
        });

        it('does not fight a manual reopen while already narrow', () => {
            expect(shouldAutoCollapseSidePanels(120, 100)).toBe(false);
        });

        it('does nothing when the canvas grows back', () => {
            expect(shouldAutoCollapseSidePanels(300, 800)).toBe(false);
        });
    });

    describe('useAutoCollapseSidePanels', () => {
        const narrowWidth = SIDE_PANEL_AUTO_COLLAPSE_MIN_EDITOR_WIDTH + BOTH_OPEN_OVERHEAD - 1;
        const wideWidth = SIDE_PANEL_AUTO_RESTORE_EDITOR_WIDTH + BOTH_OPEN_OVERHEAD + 40;

        it('keeps panels open when there is enough room', () => {
            const {result} = renderHarness(wideWidth);
            expect(result.current.panels).toEqual({leftTabStatus: true, rightTabStatus: true});
        });

        it('collapses both panels when the app starts narrow', () => {
            const {result} = renderHarness(narrowWidth);
            expect(result.current.panels).toEqual({leftTabStatus: false, rightTabStatus: false});
        });

        it('reopens the panels it collapsed once there is room again', () => {
            const {result, rerender} = renderHarness(narrowWidth);
            expect(result.current.panels).toEqual({leftTabStatus: false, rightTabStatus: false});
            rerender({width: wideWidth});
            expect(result.current.panels).toEqual({leftTabStatus: true, rightTabStatus: true});
        });

        it('waits for the restore threshold before reopening', () => {
            const {result, rerender} = renderHarness(narrowWidth);
            rerender({width: SIDE_PANEL_AUTO_RESTORE_EDITOR_WIDTH + BOTH_OPEN_OVERHEAD - 1});
            expect(result.current.panels).toEqual({leftTabStatus: false, rightTabStatus: false});
            rerender({width: SIDE_PANEL_AUTO_RESTORE_EDITOR_WIDTH + BOTH_OPEN_OVERHEAD});
            expect(result.current.panels).toEqual({leftTabStatus: true, rightTabStatus: true});
        });

        it('does not close a panel the user reopened manually', () => {
            const {result, rerender} = renderHarness(narrowWidth);
            act(() => result.current.setPanels({leftTabStatus: true, rightTabStatus: false}));
            rerender({width: narrowWidth + 1});
            expect(result.current.panels).toEqual({leftTabStatus: true, rightTabStatus: false});
        });

        it('does not reopen a panel the user closed manually', () => {
            const {result, rerender} = renderHarness(wideWidth);
            act(() => result.current.setPanels({leftTabStatus: true, rightTabStatus: false}));
            rerender({width: wideWidth + 1});
            expect(result.current.panels).toEqual({leftTabStatus: true, rightTabStatus: false});
        });
    });
});
