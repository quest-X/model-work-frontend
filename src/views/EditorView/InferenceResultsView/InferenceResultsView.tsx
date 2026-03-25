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

interface IProps {
    language: Language;
    suggestedLabelList: string[];
    segmentationResults: SegmentationResult[];
    activeImageData: ImageData | null;
    labelNames: LabelName[];
    updateSegmentationResults: (results: SegmentationResult[]) => void;
    updateActiveLabelId: (activeLabelId: string | null) => void;
}

const InferenceResultsView: React.FC<IProps> = ({language, suggestedLabelList, segmentationResults, activeImageData, labelNames, updateSegmentationResults, updateActiveLabelId}) => {
    const currentTexts = LanguageConfig[language];

    const handleDeleteSegmentationResult = (result: SegmentationResult, index: number) => {
        const newSegmentationResults = segmentationResults.filter((_, i) => i !== index);
        updateSegmentationResults(newSegmentationResults);

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
        return new Promise<string>((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (!ctx) { resolve(''); return; }
                    const size = 60;
                    canvas.width = size;
                    canvas.height = size;
                    const {x1, y1, x2, y2} = result.bbox;
                    ctx.drawImage(img, x1, y1, x2 - x1, y2 - y1, 0, 0, size, size);
                    resolve(canvas.toDataURL());
                } catch { resolve(''); }
            };
            img.onerror = () => resolve('');
            const imageData = activeImageData.fileData;
            if (typeof imageData === 'string') {
                img.src = imageData;
            } else if (imageData instanceof File || imageData instanceof Blob) {
                const objectUrl = URL.createObjectURL(imageData);
                img.src = objectUrl;
                const origOnload = img.onload;
                img.onload = (e) => { URL.revokeObjectURL(objectUrl); if (typeof origOnload === 'function') origOnload.call(img, e); };
            } else { resolve(''); }
        });
    };

    const [thumbnails, setThumbnails] = React.useState<{[key: number]: string}>({});

    React.useEffect(() => {
        if (segmentationResults && segmentationResults.length > 0 && activeImageData?.fileData) {
            segmentationResults.forEach(async (result, index) => {
                const url = await generateThumbnail(result);
                setThumbnails(prev => ({...prev, [index]: url}));
            });
        }
    }, [segmentationResults, activeImageData?.fileData]);

    return (
        <div className="InferenceResultsView">
            <div className="Header">
                <div className="HeaderText">{currentTexts.aiInference.results.title}</div>
            </div>
            <div className="Content">
                {segmentationResults && segmentationResults.length > 0 ? (
                    <div className="SegmentationResultsList">
                        {segmentationResults.map((result, index) => (
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
                                        {((result.info?.confidence || result.confidence || 0) * 100).toFixed(1)}%
                                    </div>
                                </div>
                                <div className="ResultContent">
                                    <div className="ThumbnailContainer">
                                        <div className="ThumbnailLabel">{currentTexts.aiInference.results.thumbnail}</div>
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
    segmentationResults: state.ai.segmentationResults,
    activeImageData: state.labels.imagesData[state.labels.activeImageIndex] || null,
    labelNames: state.labels.labels
});

const mapDispatchToProps = {
    updateSegmentationResults,
    updateActiveLabelId
};

export default connect(mapStateToProps, mapDispatchToProps)(InferenceResultsView);
