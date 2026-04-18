import React, {useEffect, useState} from 'react';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {PipelineStage, PipelineStore} from '../../../ai/PipelineStore';
import './PipelineCanvas.scss';

interface Stage {
    id: PipelineStage;
    label: string;
    labelEn: string;
    popupType: PopupWindowType;
}

// 真实 YOLO 管线顺序 pre → infer → post，画布渲染三个固定槽位，不可乱序。
const STAGES: Stage[] = [
    {id: 'preprocess', label: '前处理', labelEn: 'Pre-process', popupType: PopupWindowType.PIPELINE_PREPROCESS},
    {id: 'inference', label: '推理过程', labelEn: 'Inference', popupType: PopupWindowType.PIPELINE_INFERENCE},
    {id: 'postprocess', label: '后处理', labelEn: 'Post-process', popupType: PopupWindowType.PIPELINE_POSTPROCESS},
];

const DRAG_MIME = 'application/x-pipeline-stage';

interface Props {
    zh: boolean;
    onOpenPopup: (type: PopupWindowType) => void;
}

const PipelineCanvas: React.FC<Props> = ({zh, onOpenPopup}) => {
    // 从 PipelineStore 读取已持久化的激活状态，订阅变更
    const [activation, setActivation] = useState(PipelineStore.getActivation());
    const [slotDragOver, setSlotDragOver] = useState<PipelineStage | null>(null);
    const [paletteDragOver, setPaletteDragOver] = useState(false);

    useEffect(() => PipelineStore.subscribe(setActivation), []);

    const labelOf = (s: Stage) => (zh ? s.label : s.labelEn);

    // 拖拽源 —— 区分"从 palette（激活）"和"从 canvas（移除）"
    const handleDragStart = (from: 'palette' | 'canvas', id: PipelineStage) =>
        (e: React.DragEvent) => {
            e.dataTransfer.setData(DRAG_MIME, `${from}:${id}`);
            e.dataTransfer.effectAllowed = 'move';
        };

    const parseDrag = (raw: string): {from: 'palette' | 'canvas'; id: PipelineStage} | null => {
        const [from, id] = raw.split(':');
        if (!from || !id) return null;
        return {from: from as 'palette' | 'canvas', id: id as PipelineStage};
    };

    // 激活 drop 只在对应的占位符 FlowSlot 上响应（而不是整块画布）
    const handleSlotDragOver = (stage: PipelineStage) => (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        if (slotDragOver !== stage) setSlotDragOver(stage);
    };

    const handleSlotDragLeave = () => setSlotDragOver(null);

    const handleSlotDrop = (stage: PipelineStage) => (e: React.DragEvent) => {
        e.preventDefault();
        setSlotDragOver(null);
        const parsed = parseDrag(e.dataTransfer.getData(DRAG_MIME));
        if (!parsed) return;
        // 只接受从 palette 拖入且 id 匹配当前占位符；canvas 内部拖动 / mismatch 忽略
        if (parsed.from === 'palette' && parsed.id === stage) {
            PipelineStore.setStage(stage, true);
        }
    };

    // palette drop zone —— 从 canvas 拖出即移除
    const handlePaletteDragOver = (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        setPaletteDragOver(true);
    };

    const handlePaletteDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setPaletteDragOver(false);
        const parsed = parseDrag(e.dataTransfer.getData(DRAG_MIME));
        if (!parsed) return;
        if (parsed.from === 'canvas') {
            PipelineStore.setStage(parsed.id, false);
        }
    };

    // palette 上显示"未激活"阶段；全激活时也保留此条，作为"拖出即移除"的目标区
    const toolbarStages = STAGES.filter(s => !activation[s.id]);
    const paletteEmpty = toolbarStages.length === 0;

    return (
        <div className='PipelineCanvas'>
            <div
                className={`PipelineToolbar${paletteDragOver ? ' drag-over' : ''}${paletteEmpty ? ' empty' : ''}`}
                onDragOver={handlePaletteDragOver}
                onDragLeave={() => setPaletteDragOver(false)}
                onDrop={handlePaletteDrop}
            >
                <span className='ToolbarHint'>
                    {paletteEmpty
                        ? (zh ? '拖到此处区域移除：' : 'Drop here to remove:')
                        : (zh ? '拖入下方区域激活：' : 'Drag below to activate:')}
                </span>
                {toolbarStages.map(s => (
                    <div
                        key={s.id}
                        className='ToolbarNode'
                        draggable
                        onDragStart={handleDragStart('palette', s.id)}
                    >
                        {labelOf(s)}
                    </div>
                ))}
            </div>

            <div className='PipelineDropZone'>
                <div className='PipelineFlow'>
                    {STAGES.map((s, i) => {
                        const isActive = activation[s.id];
                        return (
                            <React.Fragment key={s.id}>
                                {i > 0 && <div className='FlowArrow'>→</div>}
                                {isActive ? (
                                    <div
                                        className='FlowNode'
                                        draggable
                                        onDragStart={handleDragStart('canvas', s.id)}
                                        onClick={() => onOpenPopup(s.popupType)}
                                        title={zh ? '点击编辑 / 拖出到上方移除' : 'Click to edit / drag up to remove'}
                                    >
                                        <span>{labelOf(s)}</span>
                                    </div>
                                ) : (
                                    <div
                                        className={`FlowSlot${slotDragOver === s.id ? ' drag-over' : ''}`}
                                        onDragOver={handleSlotDragOver(s.id)}
                                        onDragLeave={handleSlotDragLeave}
                                        onDrop={handleSlotDrop(s.id)}
                                        title={zh ? '从上方拖入以激活' : 'Drag from above to activate'}
                                    >
                                        <span>{labelOf(s)}</span>
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default PipelineCanvas;
