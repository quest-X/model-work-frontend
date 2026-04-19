import React from 'react';
import './InferenceResultsView.scss';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {SegmentationResult} from '../../../store/ai/types';
import {ImageData, LabelName, LabelPolygon} from '../../../store/labels/types';
import {updateSegmentationResults} from '../../../store/ai/actionCreators';
import {updateActiveLabelId} from '../../../store/labels/actionCreators';
import {LabelActions} from '../../../logic/actions/LabelActions';
import {EditorActions} from '../../../logic/actions/EditorActions';
import {EditorModel} from '../../../staticModels/EditorModel';

// 把 labelPolygons（分割标注）映射成展示用结构，兜底 segmentationResults Map 为空的情况
// 返回 shape 与 SegmentationAPIDetector.convertToUnifiedFormat 一致
function polygonsToDisplay(polys: LabelPolygon[], labelNames: LabelName[]): any[] {
    return polys.map((p, idx) => {
        const labelName = labelNames.find(ln => ln.id === p.labelId);
        const name = labelName?.name || p.suggestedLabel || 'unknown';
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        const maskData: [number, number][] = [];
        for (const v of p.vertices) {
            if (v.x < x1) x1 = v.x;
            if (v.y < y1) y1 = v.y;
            if (v.x > x2) x2 = v.x;
            if (v.y > y2) y2 = v.y;
            maskData.push([v.x, v.y]);
        }
        if (!isFinite(x1)) { x1 = y1 = x2 = y2 = 0; }
        // Shoelace area
        let area = 0;
        for (let i = 0; i < maskData.length; i++) {
            const [ax, ay] = maskData[i];
            const [bx, by] = maskData[(i + 1) % maskData.length];
            area += ax * by - bx * ay;
        }
        area = Math.abs(area) / 2;
        return {
            class_id: idx,
            class_name: name,
            confidence: p.confidence || 0,
            info: { id: idx, name, confidence: p.confidence || 0 },
            bbox: { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 },
            mask: { area, mask_data: maskData },
            _labelPolygonId: p.id,
        };
    });
}

interface IProps {
    language: Language;
    suggestedLabelList: string[];
    segmentationResults: SegmentationResult[];
    activeImageData: ImageData | null;
    labelNames: LabelName[];
    isVideoMode: boolean;
    updateSegmentationResults: (results: SegmentationResult[]) => void;
    updateActiveLabelId: (activeLabelId: string | null) => void;
}

const InferenceResultsView: React.FC<IProps> = ({language, suggestedLabelList, segmentationResults, activeImageData, labelNames, isVideoMode, updateSegmentationResults, updateActiveLabelId}) => {
    const currentTexts = LanguageConfig[language];

    const handleDeleteSegmentationResult = (result: SegmentationResult, index: number) => {
        const newSegmentationResults = segmentationResults.filter((_, i) => i !== index);
        updateSegmentationResults(newSegmentationResults, activeImageData?.id);

        if (!activeImageData) return;

        const resultName = (result.info?.name || result.class_name).toLowerCase();
        const resultCenterX = result.bbox.x1 + result.bbox.width / 2;
        const resultCenterY = result.bbox.y1 + result.bbox.height / 2;

        // ── 分割结果（有 mask）→ 删对应的 labelPolygon ──
        if (result.mask) {
            const candidates = activeImageData.labelPolygons.filter(polygon => {
                if (!polygon.isCreatedByAI) return false;
                const labelName = labelNames.find(ln => ln.id === polygon.labelId);
                if (labelName && labelName.name.toLowerCase() === resultName) return true;
                if (polygon.suggestedLabel && polygon.suggestedLabel.toLowerCase() === resultName) return true;
                return false;
            });
            if (candidates.length > 0) {
                let bestMatch = candidates[0];
                let minDistance = Number.MAX_VALUE;
                candidates.forEach(polygon => {
                    if (polygon.vertices.length === 0) return;
                    const cx = polygon.vertices.reduce((s, v) => s + v.x, 0) / polygon.vertices.length;
                    const cy = polygon.vertices.reduce((s, v) => s + v.y, 0) / polygon.vertices.length;
                    const d = Math.sqrt(Math.pow(resultCenterX - cx, 2) + Math.pow(resultCenterY - cy, 2));
                    if (d < minDistance) { minDistance = d; bestMatch = polygon; }
                });
                LabelActions.deletePolygonLabelById(activeImageData.id, bestMatch.id);
                EditorActions.fullRender();
            }
            return;
        }

        // ── 检测结果（_labelRectId 直接对应 labelRect）→ 直接删 ──
        if ((result as any)._labelRectId) {
            LabelActions.deleteRectLabelById(activeImageData.id, (result as any)._labelRectId);
            return;
        }

        // ── 普通检测结果 → 按类名 + bbox 重心距离匹配 labelRect ──
        const candidateLabelRects = activeImageData.labelRects.filter(labelRect => {
            if (!labelRect.isCreatedByAI) return false;
            const labelName = labelNames.find(ln => ln.id === labelRect.labelId);
            if (labelName && labelName.name.toLowerCase() === resultName) return true;
            if (labelRect.suggestedLabel && labelRect.suggestedLabel.toLowerCase() === resultName) return true;
            return false;
        });
        if (candidateLabelRects.length > 0) {
            let bestMatch = candidateLabelRects[0];
            let minDistance = Number.MAX_VALUE;
            candidateLabelRects.forEach(labelRect => {
                const rectCenterX = labelRect.rect.x + labelRect.rect.width / 2;
                const rectCenterY = labelRect.rect.y + labelRect.rect.height / 2;
                const d = Math.sqrt(Math.pow(resultCenterX - rectCenterX, 2) + Math.pow(resultCenterY - rectCenterY, 2));
                if (d < minDistance) { minDistance = d; bestMatch = labelRect; }
            });
            LabelActions.deleteRectLabelById(activeImageData.id, bestMatch.id);
        }
    };

    /** 返回与 result 最匹配的标注对象的 ID（labelPolygon 或 labelRect），找不到返回 null */
    const findBestMatchingLabelId = (result: SegmentationResult): string | null => {
        if (!activeImageData) return null;
        const resultName = (result.info?.name || result.class_name).toLowerCase();
        const resultCenterX = result.bbox.x1 + result.bbox.width / 2;
        const resultCenterY = result.bbox.y1 + result.bbox.height / 2;

        // 分割结果 → 找 labelPolygon
        if (result.mask) {
            const candidates = activeImageData.labelPolygons.filter(polygon => {
                if (!polygon.isCreatedByAI) return false;
                const labelName = labelNames.find(ln => ln.id === polygon.labelId);
                if (labelName && labelName.name.toLowerCase() === resultName) return true;
                if (polygon.suggestedLabel && polygon.suggestedLabel.toLowerCase() === resultName) return true;
                return false;
            });
            if (candidates.length === 0) return null;
            let best = candidates[0];
            let minD = Number.MAX_VALUE;
            candidates.forEach(polygon => {
                if (polygon.vertices.length === 0) return;
                const cx = polygon.vertices.reduce((s, v) => s + v.x, 0) / polygon.vertices.length;
                const cy = polygon.vertices.reduce((s, v) => s + v.y, 0) / polygon.vertices.length;
                const d = Math.sqrt(Math.pow(resultCenterX - cx, 2) + Math.pow(resultCenterY - cy, 2));
                if (d < minD) { minD = d; best = polygon; }
            });
            return best.id;
        }

        // 检测结果（_labelRectId 直接对应）
        if ((result as any)._labelRectId) return (result as any)._labelRectId;

        // 普通检测结果 → 找 labelRect
        const candidateLabelRects = activeImageData.labelRects.filter(labelRect => {
            if (!labelRect.isCreatedByAI) return false;
            const labelName = labelNames.find(ln => ln.id === labelRect.labelId);
            if (labelName && labelName.name.toLowerCase() === resultName) return true;
            if (labelRect.suggestedLabel && labelRect.suggestedLabel.toLowerCase() === resultName) return true;
            return false;
        });
        if (candidateLabelRects.length === 0) return null;
        let bestRect = candidateLabelRects[0];
        let minD = Number.MAX_VALUE;
        candidateLabelRects.forEach(labelRect => {
            const rectCenterX = labelRect.rect.x + labelRect.rect.width / 2;
            const rectCenterY = labelRect.rect.y + labelRect.rect.height / 2;
            const d = Math.sqrt(Math.pow(resultCenterX - rectCenterX, 2) + Math.pow(resultCenterY - rectCenterY, 2));
            if (d < minD) { minD = d; bestRect = labelRect; }
        });
        return bestRect.id;
    };

    const handleClickSegmentationResult = (result: SegmentationResult, index: number) => {
        updateActiveLabelId(findBestMatchingLabelId(result));
    };

    const handleMouseEnterSegmentationResult = (result: SegmentationResult, index: number) => {
        const id = findBestMatchingLabelId(result);
        if (id) updateActiveLabelId(id);
    };

    const handleMouseLeaveSegmentationResult = () => {
        updateActiveLabelId(null);
    };

    const getLabelColor = (className: string): string => {
        if (!className) return '#00c2ff';
        const matchingLabel = labelNames.find(label => label?.name?.toLowerCase() === className.toLowerCase());
        return matchingLabel?.color || '#00c2ff';
    };

    const getConfidenceColor = (confidence: number): string => {
        const pct = confidence * 100;
        if (pct >= 80) return '#28a745';
        if (pct >= 60) return '#ffc107';
        return '#dc3545';
    };

    const getConfidenceBackgroundColor = (confidence: number): string => {
        const pct = confidence * 100;
        if (pct >= 80) return 'rgba(40, 167, 69, 0.2)';
        if (pct >= 60) return 'rgba(255, 193, 7, 0.2)';
        return 'rgba(220, 53, 69, 0.2)';
    };

    const generateThumbnail = (result: SegmentationResult): Promise<string> => {
        if (!activeImageData?.fileData) return Promise.resolve('');

        const cropAndResolve = (source: CanvasImageSource, resolve: (url: string) => void) => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) { resolve(''); return; }
                const size = 60;
                canvas.width = size;
                canvas.height = size;
                const {x1, y1, x2, y2} = result.bbox;
                const bw = x2 - x1;
                const bh = y2 - y1;

                // 如果有 mask 多边形，用 clip 裁剪，mask 外部为黑色
                const maskPoly: [number, number][] | undefined =
                    Array.isArray(result.mask) ? result.mask
                    : result.mask?.mask_data ? result.mask.mask_data
                    : undefined;
                if (maskPoly && maskPoly.length > 2) {
                    // 先填黑色背景
                    ctx.fillStyle = '#000';
                    ctx.fillRect(0, 0, size, size);
                    // 将 mask 多边形从原图坐标映射到 canvas 坐标并做 clip
                    ctx.save();
                    ctx.beginPath();
                    const scaleX = size / bw;
                    const scaleY = size / bh;
                    maskPoly.forEach(([mx, my], i) => {
                        const cx = (mx - x1) * scaleX;
                        const cy = (my - y1) * scaleY;
                        if (i === 0) ctx.moveTo(cx, cy);
                        else ctx.lineTo(cx, cy);
                    });
                    ctx.closePath();
                    ctx.clip();
                    ctx.drawImage(source, x1, y1, bw, bh, 0, 0, size, size);
                    ctx.restore();
                } else {
                    ctx.drawImage(source, x1, y1, bw, bh, 0, 0, size, size);
                }
                resolve(canvas.toDataURL());
            } catch { resolve(''); }
        };

        const fileData = activeImageData.fileData;
        const isVideo = fileData.type?.startsWith('video/') ||
            /\.(mp4|webm|mov|avi|mkv)$/i.test(fileData.name || '');

        if (isVideo) {
            // 视频帧缩略图：需要原始分辨率的图像源（检测坐标在原始分辨率空间）
            // 优先级：videoFrameImage（原始分辨率 Image）→ VideoCanvas（FramePlayer canvas，原始分辨率）→ <video>
            return new Promise<string>((resolve) => {
                if (EditorModel.videoFrameImage) {
                    cropAndResolve(EditorModel.videoFrameImage, resolve);
                } else {
                    const videoCanvas = document.querySelector('.VideoCanvas') as HTMLCanvasElement;
                    if (videoCanvas && videoCanvas.width > 0) {
                        cropAndResolve(videoCanvas, resolve);
                    } else {
                        const video = EditorModel.videoElement || document.querySelector('video');
                        if (video && video.readyState >= 2) {
                            cropAndResolve(video, resolve);
                        } else {
                            resolve('');
                        }
                    }
                }
            });
        }

        // 普通图片：用 Image 元素加载
        return new Promise<string>((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => cropAndResolve(img, resolve);
            img.onerror = () => resolve('');
            if (typeof fileData === 'string') {
                img.src = fileData;
            } else if (fileData instanceof File || fileData instanceof Blob) {
                const objectUrl = URL.createObjectURL(fileData);
                img.onload = () => { URL.revokeObjectURL(objectUrl); cropAndResolve(img, resolve); };
                img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(''); };
                img.src = objectUrl;
            } else { resolve(''); }
        });
    };

    // 生成当前帧的推理结果显示数据
    // 视频模式下：
    //   - 优先使用 segmentationResults（分割推理结果，按 imageId 存储在 Redux 中）
    //   - 回退到 labelRects（检测推理结果存在每帧的 labelRects 中）
    // 图片模式下：直接使用 segmentationResults
    const displayResults = React.useMemo(() => {
        if (!isVideoMode) {
            // 图片模式：优先推理结果 Map，空则兜底 labelPolygons（智能标注 & dispatch 丢失场景）
            if (segmentationResults && segmentationResults.length > 0) return segmentationResults;
            if (!activeImageData) return [];
            const aiPolys = activeImageData.labelPolygons.filter(p => p.isCreatedByAI);
            if (aiPolys.length > 0) return polygonsToDisplay(aiPolys, labelNames);
            return [];
        }
        if (!activeImageData) return [];

        // 视频模式：优先 segmentationResults（分割结果已按 imageId 索引）
        if (segmentationResults && segmentationResults.length > 0) {
            return segmentationResults;
        }

        // 回退 1：labelPolygons（分割结果，包含智能标注 & dispatch 未命中 imageId 的场景）
        const aiPolys = activeImageData.labelPolygons.filter(p => p.isCreatedByAI);
        if (aiPolys.length > 0) return polygonsToDisplay(aiPolys, labelNames);

        // 回退 2：从 labelRects 读取检测结果
        const aiRects = activeImageData.labelRects.filter(r => r.isCreatedByAI);
        if (aiRects.length === 0) return [];
        return aiRects.map((rect, idx) => {
            const labelName = labelNames.find(ln => ln.id === rect.labelId);
            const name = labelName?.name || rect.suggestedLabel || 'unknown';
            return {
                class_id: idx,
                class_name: name,
                confidence: rect.confidence || 0,
                bbox: {
                    x1: rect.rect.x,
                    y1: rect.rect.y,
                    x2: rect.rect.x + rect.rect.width,
                    y2: rect.rect.y + rect.rect.height,
                    width: rect.rect.width,
                    height: rect.rect.height
                },
                mask: null,
                _labelRectId: rect.id // 用于关联
            };
        });
    }, [segmentationResults, activeImageData, labelNames, isVideoMode]);

    const [thumbnails, setThumbnails] = React.useState<{[key: number]: string}>({});
    const generatedSetRef = React.useRef(new Set<string>()); // 已生成的 key: "imageId_index"
    const lastImageIdRef = React.useRef<string | null>(null);

    // 切帧时清空
    if (activeImageData?.id !== lastImageIdRef.current) {
        lastImageIdRef.current = activeImageData?.id || null;
        generatedSetRef.current = new Set();
        // 会在下次渲染时 setThumbnails({}) 通过下面的 effect
    }

    React.useEffect(() => {
        setThumbnails({});
        generatedSetRef.current = new Set();
    }, [activeImageData?.id]);

    // 为新增结果生成缩略图
    const resultCount = displayResults.length;
    const imageId = activeImageData?.id;
    React.useEffect(() => {
        if (resultCount === 0 || !imageId) return;

        const currentResults = displayResults;
        currentResults.forEach(async (result, index) => {
            const key = `${imageId}_${index}`;
            if (generatedSetRef.current.has(key)) return;
            generatedSetRef.current.add(key); // 标记为正在生成，避免重复

            // 直接用 VideoCanvas 裁剪（绕过 generateThumbnail 的复杂逻辑）
            const vc = document.querySelector('.VideoCanvas') as HTMLCanvasElement;
            const source: CanvasImageSource | null = EditorModel.videoFrameImage || (vc && vc.width > 0 ? vc : null);

            if (!source) {
                // 非视频模式：走原有 generateThumbnail
                const url = await generateThumbnail(result);
                if (url && imageId === lastImageIdRef.current) {
                    setThumbnails(prev => ({...prev, [index]: url}));
                }
                return;
            }

            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const size = 60;
                canvas.width = size;
                canvas.height = size;
                const {x1, y1, x2, y2} = result.bbox;
                const bw = x2 - x1;
                const bh = y2 - y1;

                // 提取 mask 多边形（与 generateThumbnail 一致）
                const maskPoly: [number, number][] | undefined =
                    Array.isArray(result.mask) ? result.mask
                    : result.mask?.mask_data ? result.mask.mask_data
                    : undefined;

                if (maskPoly && maskPoly.length > 2) {
                    // mask 外部填黑色
                    ctx.fillStyle = '#000';
                    ctx.fillRect(0, 0, size, size);
                    ctx.save();
                    ctx.beginPath();
                    const scaleX = size / bw;
                    const scaleY = size / bh;
                    maskPoly.forEach(([mx, my], i) => {
                        const cx = (mx - x1) * scaleX;
                        const cy = (my - y1) * scaleY;
                        if (i === 0) ctx.moveTo(cx, cy);
                        else ctx.lineTo(cx, cy);
                    });
                    ctx.closePath();
                    ctx.clip();
                    ctx.drawImage(source, x1, y1, bw, bh, 0, 0, size, size);
                    ctx.restore();
                } else {
                    ctx.drawImage(source, x1, y1, bw, bh, 0, 0, size, size);
                }

                const url = canvas.toDataURL();
                if (url && imageId === lastImageIdRef.current) {
                    setThumbnails(prev => ({...prev, [index]: url}));
                }
            } catch {
                // 裁剪失败，静默忽略
            }
        });
    }, [resultCount, imageId]);

    return (
        <div className="InferenceResultsView">
            <div className="Header">
                <div className="HeaderText">{currentTexts.aiInference.results.title}</div>
            </div>
            <div className="Content">
                {displayResults.length > 0 ? (
                    <div className="SegmentationResultsList">
                        {displayResults.map((result, index) => (
                            <div key={index} className="SegmentationResultItem"
                                onClick={() => handleClickSegmentationResult(result, index)}
                                onMouseEnter={() => handleMouseEnterSegmentationResult(result, index)}
                                onMouseLeave={handleMouseLeaveSegmentationResult}
                                style={{ cursor: 'pointer' }}>
                                <button className="DeleteButton"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteSegmentationResult(result, index); }}
                                    title="删除此推理结果">×</button>
                                <div className="ResultHeader">
                                    <div className="ClassName" style={{color: getLabelColor(result.info?.name || result.class_name)}}>
                                        {result.info?.name || result.class_name}
                                    </div>
                                    <div className="Confidence" style={{
                                        color: getConfidenceColor(result.info?.confidence || result.confidence || 0),
                                        backgroundColor: getConfidenceBackgroundColor(result.info?.confidence || result.confidence || 0)
                                    }}>
                                        {(((result.info?.confidence ?? result.confidence ?? 0) || 0) * 100).toFixed(1)}%
                                    </div>
                                </div>
                                <div className="ResultContent">
                                    <div className="ThumbnailContainer">
                                        <div className="Thumbnail">
                                            {thumbnails[index] ? (
                                                <img src={thumbnails[index]} alt={`${result.info?.name || result.class_name} thumbnail`} className="ThumbnailImage"/>
                                            ) : activeImageData?.fileData ? (
                                                <div className="LoadingThumbnail"><span>⏳</span></div>
                                            ) : (
                                                <div className="NoThumbnail"><span>📷</span></div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="ResultDetails">
                                        <div className="DetailRow">
                                            <span className="DetailLabel">{currentTexts.aiInference.results.objectId}:</span>
                                            <span className="DetailValue">{result.class_id}</span>
                                        </div>
                                        <div className="DetailRow">
                                            <span className="DetailLabel">{currentTexts.aiInference.results.coordinates}:</span>
                                            <span className="DetailValue">({Math.round(result.bbox.x1)},{Math.round(result.bbox.y1)},{Math.round(result.bbox.x2)},{Math.round(result.bbox.y2)})</span>
                                        </div>
                                        {!result.mask && (
                                        <div className="DetailRow">
                                            <span className="DetailLabel">{currentTexts.aiInference.results.size}:</span>
                                            <span className="DetailValue">{Math.round(result.bbox.width)} × {Math.round(result.bbox.height)}</span>
                                        </div>
                                        )}
                                        {result.mask && (
                                            <div className="DetailRow">
                                                <span className="DetailLabel">{currentTexts.aiInference.results.area}:</span>
                                                <span className="DetailValue">{Math.round(result.mask.area)}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : suggestedLabelList && suggestedLabelList.length > 0 ? (
                    <div className="ResultsList">
                        <div className="SectionTitle">{language === 'zh' ? '建议标签' : 'Suggested Labels'}</div>
                        {suggestedLabelList.map((label, index) => (
                            <div key={index} className="ResultItem"><div className="ResultLabel">{label}</div></div>
                        ))}
                    </div>
                ) : (
                    <div className="EmptyResults">
                        <img src="/ico/brain.png" alt="AI" className="EmptyIcon"/>
                        <div className="EmptyText">{currentTexts.aiInference.results.noResults}</div>
                    </div>
                )}
            </div>
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
    suggestedLabelList: state.ai.suggestedLabelList,
    segmentationResults: (() => {
        const imageId = state.labels.imagesData[state.labels.activeImageIndex]?.id;
        if (imageId && state.ai.imageSegmentationResults.has(imageId)) {
            return state.ai.imageSegmentationResults.get(imageId)!;
        }
        return [];
    })(),
    activeImageData: state.labels.imagesData[state.labels.activeImageIndex] || null,
    labelNames: state.labels.labels,
    isVideoMode: state.video?.isVideoMode || false
});

const mapDispatchToProps = {
    updateSegmentationResults,
    updateActiveLabelId
};

export default connect(mapStateToProps, mapDispatchToProps)(InferenceResultsView);
