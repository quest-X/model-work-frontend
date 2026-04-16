import React from 'react';
import './InferenceResultsView.scss';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {SegmentationResult} from '../../../store/ai/types';
import {ImageData, LabelName} from '../../../store/labels/types';
import {updateSegmentationResults} from '../../../store/ai/actionCreators';
import {updateActiveLabelId} from '../../../store/labels/actionCreators';
import {LabelActions} from '../../../logic/actions/LabelActions';
import {EditorModel} from '../../../staticModels/EditorModel';

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

        if (activeImageData) {
            const candidateLabelRects = activeImageData.labelRects.filter(labelRect => {
                if (!labelRect.isCreatedByAI) return false;
                const labelName = labelNames.find(ln => ln.id === labelRect.labelId);
                if (labelName && labelName.name.toLowerCase() === (result.info?.name || result.class_name).toLowerCase()) return true;
                if (labelRect.suggestedLabel && labelRect.suggestedLabel.toLowerCase() === (result.info?.name || result.class_name).toLowerCase()) return true;
                return false;
            });

            if (candidateLabelRects.length > 0) {
                let bestMatch = candidateLabelRects[0];
                let minDistance = Number.MAX_VALUE;
                candidateLabelRects.forEach(labelRect => {
                    const resultCenterX = result.bbox.x1 + result.bbox.width / 2;
                    const resultCenterY = result.bbox.y1 + result.bbox.height / 2;
                    const rectCenterX = labelRect.rect.x + labelRect.rect.width / 2;
                    const rectCenterY = labelRect.rect.y + labelRect.rect.height / 2;
                    const distance = Math.sqrt(Math.pow(resultCenterX - rectCenterX, 2) + Math.pow(resultCenterY - rectCenterY, 2));
                    if (distance < minDistance) { minDistance = distance; bestMatch = labelRect; }
                });
                LabelActions.deleteRectLabelById(activeImageData.id, bestMatch.id);
            }
        }
    };

    const findBestMatchingLabelRect = (result: SegmentationResult) => {
        if (!activeImageData) return null;
        const candidateLabelRects = activeImageData.labelRects.filter(labelRect => {
            if (!labelRect.isCreatedByAI) return false;
            const labelName = labelNames.find(ln => ln.id === labelRect.labelId);
            if (labelName && labelName.name.toLowerCase() === (result.info?.name || result.class_name).toLowerCase()) return true;
            if (labelRect.suggestedLabel && labelRect.suggestedLabel.toLowerCase() === (result.info?.name || result.class_name).toLowerCase()) return true;
            return false;
        });
        if (candidateLabelRects.length === 0) return null;
        let bestMatch = candidateLabelRects[0];
        let minDistance = Number.MAX_VALUE;
        candidateLabelRects.forEach(labelRect => {
            const resultCenterX = result.bbox.x1 + result.bbox.width / 2;
            const resultCenterY = result.bbox.y1 + result.bbox.height / 2;
            const rectCenterX = labelRect.rect.x + labelRect.rect.width / 2;
            const rectCenterY = labelRect.rect.y + labelRect.rect.height / 2;
            const distance = Math.sqrt(Math.pow(resultCenterX - rectCenterX, 2) + Math.pow(resultCenterY - rectCenterY, 2));
            if (distance < minDistance) { minDistance = distance; bestMatch = labelRect; }
        });
        return bestMatch;
    };

    const handleClickSegmentationResult = (result: SegmentationResult, index: number) => {
        const bestMatch = findBestMatchingLabelRect(result);
        updateActiveLabelId(bestMatch ? bestMatch.id : null);
    };

    const handleMouseEnterSegmentationResult = (result: SegmentationResult, index: number) => {
        const bestMatch = findBestMatchingLabelRect(result);
        if (bestMatch) updateActiveLabelId(bestMatch.id);
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
                ctx.drawImage(source, x1, y1, x2 - x1, y2 - y1, 0, 0, size, size);
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
    // 视频模式下：始终从当前帧的 labelRects 生成（批量检测结果存在每帧的 labelRects 中）
    // 图片模式下：优先使用全局 segmentationResults（单张检测时设置），否则从 labelRects 回退
    const displayResults = React.useMemo(() => {
        if (!isVideoMode) return segmentationResults || [];
        if (!activeImageData) return [];
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
                ctx.drawImage(source, x1, y1, x2 - x1, y2 - y1, 0, 0, size, size);
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
                                        <div className="DetailRow">
                                            <span className="DetailLabel">{currentTexts.aiInference.results.size}:</span>
                                            <span className="DetailValue">{Math.round(result.bbox.width)} × {Math.round(result.bbox.height)}</span>
                                        </div>
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
                        <div className="EmptySubText">{currentTexts.aiInference.results.noResultsHint}</div>
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
