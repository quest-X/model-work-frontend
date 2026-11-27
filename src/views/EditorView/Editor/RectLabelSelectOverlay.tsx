import React, {useEffect, useRef, useState} from 'react';
import {EditorData} from '../../../data/EditorData';
import {IPoint} from '../../../interfaces/IPoint';
import {LabelName, LabelRect} from '../../../store/labels/types';
import {LabelStatus} from '../../../data/enums/LabelStatus';
import {RenderEngineSettings} from '../../../settings/RenderEngineSettings';
import {Settings} from '../../../settings/Settings';
import {RenderEngineUtil} from '../../../utils/RenderEngineUtil';
import {subscribeRectLabelOverlayPosition} from '../../../utils/RectLabelOverlayPositionBus';

export type RectLabelStyle = 'style-1' | 'style-2';

interface IProps {
    editorData: EditorData;
    labelRects: LabelRect[];
    labelNames: LabelName[];
    enablePerClassColoration?: boolean;
    styleVariant?: RectLabelStyle;
    visible: boolean;
    onChange: (rectId: string, labelId: string) => void;
    onActivate: (rectId: string) => void;
    onInteractionChange: (active: boolean) => void;
}

const stopPropagation = (event: React.SyntheticEvent) => event.stopPropagation();
const formatConfidence = (value: number | undefined): string =>
    Number.isFinite(value) && value >= 0 && value <= 1 ? `${(value * 100).toFixed(1)}%` : '';

const formatModelDetail = (labelRect: LabelRect): string =>
    formatConfidence(labelRect.confidence) || labelRect.annotationModel || labelRect.annotationSource || '';

const modelDetailTitle = (labelRect: LabelRect): string | undefined =>
    labelRect.annotationModel || labelRect.annotationSource || undefined;

const withAlpha = (color: string, alpha: number): string => {
    const hex = color.replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return color;

    return `rgba(${parseInt(hex.substring(0, 2), 16)}, ${parseInt(hex.substring(2, 4), 16)}, ${parseInt(hex.substring(4, 6), 16)}, ${alpha})`;
};

// 菜单底色跟随左侧标签块：有标签用标签颜色，未指定标签时用白色。不描边，避免和标签块叠在一起显脏。
const menuStyleFor = (color?: string) => ({
    backgroundColor: color ? withAlpha(color, 0.8) : '#ffffff',
});

const HANDLE_SIZE = Settings.RESIZE_HANDLE_DIMENSION_PX;
const LINE_THICKNESS = RenderEngineSettings.LINE_THICKNESS;

interface IRectOutlineProps {
    editorData: EditorData;
    labelRect: LabelRect;
    position: IPoint;
    color: string;
    anchorColor: string;
}

const outlineAnchors = (width: number, height: number): IPoint[] => [
    {x: 0, y: 0}, {x: width / 2, y: 0}, {x: width, y: 0},
    {x: width, y: height / 2}, {x: width, y: height}, {x: width / 2, y: height},
    {x: 0, y: height}, {x: 0, y: height / 2},
];

// 菜单展开时把标注框的边框和锚点重画在 DOM 上层，菜单才能贴着框内左上角而不遮住它们。
const RectOutline: React.FC<IRectOutlineProps> = ({editorData, labelRect, position, color, anchorColor}) => {
    const bottomRight: IPoint = RenderEngineUtil.transferPointFromImageToViewPortContent(
        {x: labelRect.rect.x + labelRect.rect.width, y: labelRect.rect.y + labelRect.rect.height},
        editorData,
    );
    const width = Math.max(0, bottomRight.x - position.x);
    const height = Math.max(0, bottomRight.y - position.y);
    const half = HANDLE_SIZE / 2;
    const offset = LINE_THICKNESS / 2;

    return <svg
        aria-hidden='true'
        className='RectLabelDropdown__outline'
        height={height + LINE_THICKNESS}
        width={width + LINE_THICKNESS}
    >
        <rect
            fill='none'
            height={height}
            stroke={color}
            strokeWidth={LINE_THICKNESS}
            width={width}
            x={offset}
            y={offset}
        />
        {outlineAnchors(width, height).map(anchor => <rect
            fill={anchorColor}
            height={HANDLE_SIZE}
            key={`${anchor.x}-${anchor.y}`}
            width={HANDLE_SIZE}
            x={anchor.x + offset - half}
            y={anchor.y + offset - half}
        />)}
    </svg>;
};

const resolveOutlineColors = (labelColor: string | undefined, enablePerClassColoration: boolean) => ({
    color: labelColor || RenderEngineSettings.DEFAULT_LINE_COLOR,
    anchorColor: enablePerClassColoration
        ? RenderEngineSettings.DEFAULT_ANCHOR_COLOR
        : RenderEngineSettings.ACTIVE_ANCHOR_COLOR,
});

const resolveCurrentLabel = (labelRect: LabelRect, labelNames: LabelName[]) => {
    const assignedLabel = labelNames.find(labelName => labelName.id === labelRect.labelId);
    const suggestedLabel = labelNames.find(labelName =>
        labelName.name.toLowerCase() === labelRect.suggestedLabel?.toLowerCase());
    const currentLabel = assignedLabel || suggestedLabel;
    return {
        currentLabel,
        value: currentLabel?.id || '',
        displayName: currentLabel?.name || labelRect.suggestedLabel || 'none',
    };
};

export const RectLabelSelectOverlay: React.FC<IProps> = ({
    editorData,
    labelRects,
    labelNames,
    enablePerClassColoration = true,
    styleVariant = 'style-2',
    visible,
    onChange,
    onActivate,
    onInteractionChange,
}) => {
    const [openRectId, setOpenRectId] = useState<string | null>(null);
    const layerRef = useRef<HTMLDivElement>(null);
    const dropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    useEffect(() => {
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (layerRef.current && !layerRef.current.contains(event.target as Node)) {
                setOpenRectId(null);
                onInteractionChange(false);
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpenRectId(null);
                onInteractionChange(false);
            }
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('mousedown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [onInteractionChange]);

    useEffect(() => subscribeRectLabelOverlayPosition(({rectId, position}) => {
        const dropdown = dropdownRefs.current.get(rectId);
        if (!dropdown) return;

        dropdown.style.left = `${position.x}px`;
        dropdown.style.top = `${position.y}px`;
    }), []);

    if (!visible || !editorData?.viewPortContentImageRect || !editorData?.realImageSize) {
        return null;
    }

    return <div className='RectLabelDropdownLayer' ref={layerRef}>
        {labelRects
            .filter(labelRect => labelRect.isVisible
                && !labelRect.isPrompt
                && labelRect.status === LabelStatus.ACCEPTED)
            .map(labelRect => {
                const {currentLabel, value, displayName} = resolveCurrentLabel(labelRect, labelNames);
                const detail = formatModelDetail(labelRect);
                const position = RenderEngineUtil.transferPointFromImageToViewPortContent(
                    {x: labelRect.rect.x, y: labelRect.rect.y},
                    editorData,
                );
                const style1 = styleVariant === 'style-1';
                const isOpen = openRectId === labelRect.id;
                const labelColor = enablePerClassColoration ? currentLabel?.color : undefined;
                // 未指定标签时用白色，和未标注矩形的白色边框保持一致。
                const triggerBackground = labelColor
                    ? withAlpha(labelColor, 0.8)
                    : '#ffffff';
                const {color: outlineColor, anchorColor: outlineAnchorColor} =
                    resolveOutlineColors(labelColor, enablePerClassColoration);

                return <div
                    className={`RectLabelDropdown RectLabelDropdown--${styleVariant}${isOpen ? ' is-open' : ''}`}
                    data-label-rect-id={labelRect.id}
                    key={labelRect.id}
                    ref={element => {
                        if (element) dropdownRefs.current.set(labelRect.id, element);
                        else dropdownRefs.current.delete(labelRect.id);
                    }}
                    style={{top: position.y, left: position.x, width: 'max-content'}}
                    onMouseEnter={() => onInteractionChange(true)}
                    // 离开下拉框就恢复自定义光标，即使菜单还开着，避免光标消失。
                    onMouseLeave={() => onInteractionChange(false)}
                    onMouseDown={stopPropagation}
                    onMouseUp={stopPropagation}
                    onClick={stopPropagation}
                >
                    <button
                        aria-expanded={isOpen}
                        aria-haspopup='listbox'
                        aria-label={`修改 ${displayName} 标签`}
                        className='RectLabelDropdown__trigger'
                        style={style1 ? undefined : {
                            backgroundColor: triggerBackground,
                            color: labelColor ? '#fff' : '#000',
                        }}
                        title='点击切换标注标签'
                        type='button'
                        onClick={() => {
                            onActivate(labelRect.id);
                            onInteractionChange(true);
                            setOpenRectId(isOpen ? null : labelRect.id);
                        }}
                        onFocus={() => {
                            onActivate(labelRect.id);
                            onInteractionChange(true);
                        }}
                        onKeyDown={event => {
                            if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                setOpenRectId(labelRect.id);
                            }
                        }}
                    >
                        {style1 && <span
                            aria-hidden='true'
                            className='RectLabelDropdown__color'
                            style={{backgroundColor: currentLabel?.color || '#ec2aa6'}}
                        />}
                        <span className='RectLabelDropdown__name'>{displayName}</span>
                        {detail && <span className='RectLabelDropdown__confidence'
                            title={modelDetailTitle(labelRect)}>{detail}</span>}
                    </button>
                    {isOpen && <RectOutline
                        anchorColor={outlineAnchorColor}
                        color={outlineColor}
                        editorData={editorData}
                        labelRect={labelRect}
                        position={position}
                    />}
                    {isOpen && <div
                        aria-label='选择标注标签'
                        className={`RectLabelDropdown__menu${labelColor ? '' : ' is-unlabeled'}`}
                        role='listbox'
                        style={menuStyleFor(labelColor)}
                    >
                        {!labelNames.length && <div className='RectLabelDropdown__empty'>
                            暂无标签
                        </div>}
                        <button
                            aria-label='none'
                            aria-selected={!value}
                            className={`RectLabelDropdown__option${!value ? ' is-selected' : ''}`}
                            role='option'
                            type='button'
                            onClick={() => {
                                onChange(labelRect.id, '');
                                setOpenRectId(null);
                                onInteractionChange(false);
                            }}
                        >
                            <span aria-hidden='true' className='RectLabelDropdown__check'>
                                {!value ? '✓' : ''}
                            </span>
                            <span
                                aria-hidden='true'
                                className='RectLabelDropdown__optionColor'
                                style={{backgroundColor: 'rgba(255, 255, 255, 0.55)'}}
                            />
                            <span className='RectLabelDropdown__optionName'>none</span>
                        </button>
                        {labelNames.map(labelName => {
                            const selected = labelName.id === value;
                            return <button
                                aria-label={labelName.name}
                                aria-selected={selected}
                                className={`RectLabelDropdown__option${selected ? ' is-selected' : ''}`}
                                key={labelName.id}
                                role='option'
                                type='button'
                                onClick={() => {
                                    onChange(labelRect.id, labelName.id);
                                    setOpenRectId(null);
                                    onInteractionChange(false);
                                }}
                            >
                                <span aria-hidden='true' className='RectLabelDropdown__check'>
                                    {selected ? '✓' : ''}
                                </span>
                                <span
                                    aria-hidden='true'
                                    className='RectLabelDropdown__optionColor'
                                    style={{backgroundColor: labelName.color || '#888'}}
                                />
                                <span className='RectLabelDropdown__optionName'>{labelName.name}</span>
                            </button>;
                        })}
                    </div>}
                </div>;
            })}
    </div>;
};
