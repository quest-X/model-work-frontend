import {useEffect, useRef} from 'react';
import {Settings} from '../../../settings/Settings';

// 画布低于该宽度时折叠左右内容侧栏，只保留 23px 图标条。
export const SIDE_PANEL_AUTO_COLLAPSE_MIN_EDITOR_WIDTH = 420;
// 恢复阈值比折叠阈值略高，避免窗口在临界点附近拖动时反复开合。
export const SIDE_PANEL_AUTO_RESTORE_EDITOR_WIDTH = SIDE_PANEL_AUTO_COLLAPSE_MIN_EDITOR_WIDTH + 40;

export interface SidePanelOpenState {
    leftTabStatus: boolean;
    rightTabStatus: boolean;
}

export interface SidePanelAutoAdjustment {
    // null 表示不需要改变现有面板状态。
    next: SidePanelOpenState | null;
    // 更新后的“由自动逻辑折叠”标记；用户手动打开过的面板会被移除。
    autoCollapsed: SidePanelOpenState;
    editorWidth: number;
}

const sideBarWidth = (open: boolean): number =>
    open ? Settings.SIDE_NAVIGATION_BAR_WIDTH_OPEN_PX : Settings.SIDE_NAVIGATION_BAR_WIDTH_CLOSED_PX;

export const measureEditorWidth = (windowWidth: number, panels: SidePanelOpenState): number =>
    windowWidth - sideBarWidth(panels.leftTabStatus) - sideBarWidth(panels.rightTabStatus);

// 只在画布从可用跨到不可用时折叠；已经处于窄窗口时不再与用户手动展开冲突。
export const shouldAutoCollapseSidePanels = (
    previousEditorWidth: number | null,
    editorWidth: number,
): boolean => {
    const wasUsable = previousEditorWidth === null
        || previousEditorWidth >= SIDE_PANEL_AUTO_COLLAPSE_MIN_EDITOR_WIDTH;
    return wasUsable && editorWidth < SIDE_PANEL_AUTO_COLLAPSE_MIN_EDITOR_WIDTH;
};

export const resolveSidePanelAutoAdjustment = (
    windowWidth: number,
    actual: SidePanelOpenState,
    autoCollapsed: SidePanelOpenState,
    previousEditorWidth: number | null,
): SidePanelAutoAdjustment => {
    // 用户手动重新打开后，不再由自动逻辑接管对应侧栏。
    const tracked: SidePanelOpenState = {
        leftTabStatus: autoCollapsed.leftTabStatus && !actual.leftTabStatus,
        rightTabStatus: autoCollapsed.rightTabStatus && !actual.rightTabStatus,
    };
    // 用“若恢复被自动折叠的面板”后的宽度判断折叠还是展开。
    const effective: SidePanelOpenState = {
        leftTabStatus: actual.leftTabStatus || tracked.leftTabStatus,
        rightTabStatus: actual.rightTabStatus || tracked.rightTabStatus,
    };
    const editorWidth = measureEditorWidth(windowWidth, effective);

    if (editorWidth < SIDE_PANEL_AUTO_COLLAPSE_MIN_EDITOR_WIDTH) {
        const shouldCollapse = shouldAutoCollapseSidePanels(previousEditorWidth, editorWidth)
            && (actual.leftTabStatus || actual.rightTabStatus);
        if (!shouldCollapse) return {next: null, autoCollapsed: tracked, editorWidth};
        return {
            next: {leftTabStatus: false, rightTabStatus: false},
            autoCollapsed: {
                leftTabStatus: tracked.leftTabStatus || actual.leftTabStatus,
                rightTabStatus: tracked.rightTabStatus || actual.rightTabStatus,
            },
            editorWidth,
        };
    }

    const shouldRestore = editorWidth >= SIDE_PANEL_AUTO_RESTORE_EDITOR_WIDTH
        && (tracked.leftTabStatus || tracked.rightTabStatus);
    if (!shouldRestore) return {next: null, autoCollapsed: tracked, editorWidth};
    return {
        next: effective,
        autoCollapsed: {leftTabStatus: false, rightTabStatus: false},
        editorWidth,
    };
};

/**
 * 窄窗口自动折叠左右侧栏，空间恢复后重新展开此前被自动折叠的面板。
 * 用户手动打开过的面板会交还控制权，不会再被自动关/开。
 */
export const useAutoCollapseSidePanels = (
    windowWidth: number | undefined,
    panels: SidePanelOpenState,
    onChange: (next: SidePanelOpenState, previous: SidePanelOpenState) => void,
): void => {
    const panelsRef = useRef(panels);
    panelsRef.current = panels;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    // 记录哪些侧栏是被自动折叠的。
    const autoCollapsedRef = useRef<SidePanelOpenState>({leftTabStatus: false, rightTabStatus: false});
    const previousEditorWidthRef = useRef<number | null>(null);

    useEffect(() => {
        if (!windowWidth) return;
        const actual = panelsRef.current;
        const adjustment = resolveSidePanelAutoAdjustment(
            windowWidth,
            actual,
            autoCollapsedRef.current,
            previousEditorWidthRef.current,
        );
        autoCollapsedRef.current = adjustment.autoCollapsed;
        previousEditorWidthRef.current = adjustment.editorWidth;
        if (adjustment.next) onChangeRef.current(adjustment.next, actual);
    }, [windowWidth]);
};
