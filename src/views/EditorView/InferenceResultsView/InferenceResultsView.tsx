import React from 'react';
import './InferenceResultsView.scss';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {SegmentationResult} from '../../../ai/SegmentationAPIDetector';
// import {LabelsSelector} from '../../../store/labels/reducer';
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
    
    // 删除推理结果和对应标签的处理函数
    const handleDeleteSegmentationResult = (result: SegmentationResult, index: number) => {
        console.log(`🗑️ 删除推理结果: ${result.info?.name || result.class_name} (索引: ${index})`);
        
        // 1. 从推理结果中删除这个项目
        const newSegmentationResults = segmentationResults.filter((_, i) => i !== index);
        updateSegmentationResults(newSegmentationResults);
        
        // 2. 尝试找到最匹配的单个标注框并删除
        if (activeImageData) {
            // 查找与推理结果位置最接近的AI创建的标注框
            const candidateLabelRects = activeImageData.labelRects.filter(labelRect => {
                // 检查是否是AI创建的标注框
                if (!labelRect.isCreatedByAI) return false;
                
                // 检查标签名称是否匹配
                const labelName = labelNames.find(ln => ln.id === labelRect.labelId);
                if (labelName && labelName.name.toLowerCase() === (result.info?.name || result.class_name).toLowerCase()) {
                    return true;
                }
                
                // 检查建议标签名称是否匹配
                if (labelRect.suggestedLabel && labelRect.suggestedLabel.toLowerCase() === (result.info?.name || result.class_name).toLowerCase()) {
                    return true;
                }
                
                return false;
            });
            
            if (candidateLabelRects.length > 0) {
                // 如果有多个候选标注框，选择与推理结果位置最接近的一个
                let bestMatch = candidateLabelRects[0];
                let minDistance = Number.MAX_VALUE;
                
                candidateLabelRects.forEach(labelRect => {
                    // 计算推理结果边界框中心点
                    const resultCenterX = result.bbox.x1 + result.bbox.width / 2;
                    const resultCenterY = result.bbox.y1 + result.bbox.height / 2;
                    
                    // 计算标注框中心点
                    const rectCenterX = labelRect.rect.x + labelRect.rect.width / 2;
                    const rectCenterY = labelRect.rect.y + labelRect.rect.height / 2;
                    
                    // 计算欧几里得距离
                    const distance = Math.sqrt(
                        Math.pow(resultCenterX - rectCenterX, 2) + 
                        Math.pow(resultCenterY - rectCenterY, 2)
                    );
                    
                    if (distance < minDistance) {
                        minDistance = distance;
                        bestMatch = labelRect;
                    }
                });
                
                console.log(`🎯 找到最匹配的标注框: ${bestMatch.id} (距离: ${minDistance.toFixed(2)})`);
                LabelActions.deleteRectLabelById(activeImageData.id, bestMatch.id);
            } else {
                console.log(`⚠️ 未找到匹配的标注框`);
            }
        }
        
        console.log(`✅ 删除完成，剩余推理结果数量: ${newSegmentationResults.length}`);
    };

    // 查找与推理结果匹配的最佳标注框
    const findBestMatchingLabelRect = (result: SegmentationResult) => {
        if (!activeImageData) return null;

        // 查找与推理结果位置最接近的AI创建的标注框
        const candidateLabelRects = activeImageData.labelRects.filter(labelRect => {
            // 检查是否是AI创建的标注框
            if (!labelRect.isCreatedByAI) return false;
            
            // 检查标签名称是否匹配
            const labelName = labelNames.find(ln => ln.id === labelRect.labelId);
            if (labelName && labelName.name.toLowerCase() === (result.info?.name || result.class_name).toLowerCase()) {
                return true;
            }
            
            // 检查建议标签名称是否匹配
            if (labelRect.suggestedLabel && labelRect.suggestedLabel.toLowerCase() === (result.info?.name || result.class_name).toLowerCase()) {
                return true;
            }
            
            return false;
        });
        
        if (candidateLabelRects.length > 0) {
            // 如果有多个候选标注框，选择与推理结果位置最接近的一个
            let bestMatch = candidateLabelRects[0];
            let minDistance = Number.MAX_VALUE;
            
            candidateLabelRects.forEach(labelRect => {
                // 计算推理结果边界框中心点
                const resultCenterX = result.bbox.x1 + result.bbox.width / 2;
                const resultCenterY = result.bbox.y1 + result.bbox.height / 2;
                
                // 计算标注框中心点
                const rectCenterX = labelRect.rect.x + labelRect.rect.width / 2;
                const rectCenterY = labelRect.rect.y + labelRect.rect.height / 2;
                
                // 计算欧几里得距离
                const distance = Math.sqrt(
                    Math.pow(resultCenterX - rectCenterX, 2) + 
                    Math.pow(resultCenterY - rectCenterY, 2)
                );
                
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = labelRect;
                }
            });
            
            return bestMatch;
        }
        
        return null;
    };

    // 点击推理结果项目，选中对应的标注框
    const handleClickSegmentationResult = (result: SegmentationResult, index: number) => {
        console.log(`🎯 点击推理结果: ${result.info?.name || result.class_name} (索引: ${index})`);
        
        const bestMatch = findBestMatchingLabelRect(result);
        if (bestMatch) {
            console.log(`🎯 选中最匹配的标注框: ${bestMatch.id}`);
            updateActiveLabelId(bestMatch.id);
        } else {
            console.log(`⚠️ 未找到匹配的标注框`);
            updateActiveLabelId(null);
        }
    };

    // 鼠标悬停进入推理结果项目，激活对应的标注框
    const handleMouseEnterSegmentationResult = (result: SegmentationResult, index: number) => {
        console.log(`🔍 悬停推理结果: ${result.info?.name || result.class_name} (索引: ${index})`);
        
        const bestMatch = findBestMatchingLabelRect(result);
        if (bestMatch) {
            console.log(`🔍 激活最匹配的标注框: ${bestMatch.id}`);
            updateActiveLabelId(bestMatch.id);
        }
    };

    // 鼠标悬停离开推理结果项目，取消激活
    const handleMouseLeaveSegmentationResult = () => {
        console.log(`🔍 离开推理结果，取消激活`);
        updateActiveLabelId(null);
    };
    
    // 根据类别名称获取标签颜色
    const getLabelColor = (className: string): string => {
        if (!className) {
            return '#00c2ff'; // 默认蓝色
        }
        const matchingLabel = labelNames.find(label => 
            label?.name?.toLowerCase() === className.toLowerCase()
        );
        return matchingLabel?.color || '#00c2ff'; // 默认蓝色
    };
    
    // 根据置信度获取颜色
    const getConfidenceColor = (confidence: number): string => {
        const percentage = confidence * 100;
        if (percentage >= 80) {
            return '#28a745'; // 绿色 - 优质标签
        } else if (percentage >= 60) {
            return '#ffc107'; // 黄色 - 良好标签
        } else {
            return '#dc3545'; // 红色 - 较差标签
        }
    };
    
    // 根据置信度获取背景色（半透明）
    const getConfidenceBackgroundColor = (confidence: number): string => {
        const percentage = confidence * 100;
        if (percentage >= 80) {
            return 'rgba(40, 167, 69, 0.2)'; // 绿色背景
        } else if (percentage >= 60) {
            return 'rgba(255, 193, 7, 0.2)'; // 黄色背景
        } else {
            return 'rgba(220, 53, 69, 0.2)'; // 红色背景
        }
    };
    
    // 根据坐标从原图中裁剪缩略图
    const generateThumbnail = (result: SegmentationResult): string => {
        if (!activeImageData?.fileData) return '';
        
        return new Promise<string>((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        resolve('');
                        return;
                    }
                    
                    // 缩略图尺寸
                    const thumbnailSize = 60;
                    canvas.width = thumbnailSize;
                    canvas.height = thumbnailSize;
                    
                    // 获取检测区域坐标
                    const {x1, y1, x2, y2} = result.bbox;
                    const cropWidth = x2 - x1;
                    const cropHeight = y2 - y1;
                    
                    console.log('🖼️ 生成缩略图:', {
                        class: result.info?.name || result.class_name,
                        bbox: {x1, y1, x2, y2},
                        cropSize: {width: cropWidth, height: cropHeight},
                        imageSize: {width: img.width, height: img.height}
                    });
                    
                    // 将裁剪区域绘制到canvas上
                    ctx.drawImage(
                        img,
                        x1, y1, cropWidth, cropHeight, // 源区域（检测框）
                        0, 0, thumbnailSize, thumbnailSize // 目标区域（缩略图）
                    );
                    
                    const thumbnailDataUrl = canvas.toDataURL();
                    console.log('✅ 缩略图生成成功:', result.info?.name || result.class_name);
                    resolve(thumbnailDataUrl);
                } catch (error) {
                    console.log('❌ 缩略图生成失败:', error);
                    resolve('');
                }
            };
            
            img.onerror = (error) => {
                console.log('❌ 原图加载失败:', {
                    error,
                    fileDataType: typeof activeImageData.fileData,
                    fileDataLength: activeImageData.fileData?.length,
                    fileDataStart: activeImageData.fileData?.substring(0, 50)
                });
                resolve('');
            };
            
            // 检查并处理图像数据格式
            const imageData = activeImageData.fileData;
            console.log('🔍 图像数据格式检查:', {
                type: typeof imageData,
                constructor: imageData?.constructor?.name,
                isFile: imageData instanceof File,
                isBlob: imageData instanceof Blob
            });
            
            // 处理不同类型的图像数据
            if (typeof imageData === 'string') {
                // 字符串格式（DataURL或URL）
                img.src = imageData;
            } else if (imageData instanceof File || imageData instanceof Blob) {
                // File或Blob对象，使用createObjectURL
                const objectUrl = URL.createObjectURL(imageData);
                img.src = objectUrl;
                console.log('🔄 使用 createObjectURL 加载 File/Blob');
                
                // 图像加载完成后清理URL
                const originalOnload = img.onload;
                img.onload = (e) => {
                    URL.revokeObjectURL(objectUrl);
                    originalOnload?.call(img, e);
                };
            } else {
                console.log('❌ 不支持的图像数据格式:', typeof imageData);
                resolve('');
            }
        });
    };
    
    // 使用React状态管理缩略图
    const [thumbnails, setThumbnails] = React.useState<{[key: number]: string}>({});
    
    // 当推理结果变化时生成缩略图
    React.useEffect(() => {
        if (segmentationResults && segmentationResults.length > 0 && activeImageData?.fileData) {
            console.log('🔄 开始生成', segmentationResults.length, '个缩略图...');
            
            segmentationResults.forEach(async (result, index) => {
                const thumbnailUrl = await generateThumbnail(result);
                setThumbnails(prev => ({
                    ...prev,
                    [index]: thumbnailUrl
                }));
            });
        }
    }, [segmentationResults, activeImageData?.fileData]);
    
    console.log('🔍 InferenceResultsView Rendered:', {
        segmentationResultsLength: segmentationResults?.length,
        hasActiveImageData: !!activeImageData,
        thumbnailsGenerated: Object.keys(thumbnails).length
    });
    
    return (
        <div className="InferenceResultsView">
            <div className="Header">
                <div className="HeaderText">
                    {currentTexts.aiInference.results.title}
                </div>
            </div>
            <div className="Content">
                {(() => {
                    console.log('🔍 Rendering condition check:', {
                        hasResults: segmentationResults && segmentationResults.length > 0,
                        resultsArray: segmentationResults
                    });
                    return null;
                })()}
                {segmentationResults && segmentationResults.length > 0 ? (
                    <div className="SegmentationResultsList">
                        {segmentationResults.map((result, index) => (
                            <div 
                                key={index} 
                                className="SegmentationResultItem"
                                onClick={() => handleClickSegmentationResult(result, index)}
                                onMouseEnter={() => handleMouseEnterSegmentationResult(result, index)}
                                onMouseLeave={handleMouseLeaveSegmentationResult}
                                style={{ cursor: 'pointer' }}
                            >
                                <button 
                                    className="DeleteButton"
                                    onClick={(e) => {
                                        e.stopPropagation(); // 阻止冒泡到父元素
                                        handleDeleteSegmentationResult(result, index);
                                    }}
                                    title="删除此推理结果"
                                >
                                    ×
                                </button>
                                <div className="ResultHeader">
                                    <div 
                                        className="ClassName"
                                        style={{
                                            color: getLabelColor(result.info?.name || result.class_name)
                                        }}
                                    >
                                        {result.info?.name || result.class_name}
                                    </div>
                                    <div 
                                        className="Confidence"
                                        style={{
                                            color: getConfidenceColor(result.info?.confidence || result.confidence || 0),
                                            backgroundColor: getConfidenceBackgroundColor(result.info?.confidence || result.confidence || 0)
                                        }}
                                    >
                                        {((result.info?.confidence || result.confidence || 0) * 100).toFixed(1)}%
                                    </div>
                                </div>
                                
                                <div className="ResultContent">
                                    <div className="ThumbnailContainer">
                                        <div className="ThumbnailLabel">
                                            {currentTexts.aiInference.results.thumbnail}
                                        </div>
                                        <div className="Thumbnail">
                                            {thumbnails[index] ? (
                                                <img 
                                                    src={thumbnails[index]}
                                                    alt={`${result.info?.name || result.class_name} thumbnail`}
                                                    className="ThumbnailImage"
                                                />
                                            ) : activeImageData?.fileData ? (
                                                <div className="LoadingThumbnail">
                                                    <span>⏳</span>
                                                </div>
                                            ) : (
                                                <div className="NoThumbnail">
                                                    <span>📷</span>
                                                </div>
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
                                            <span className="DetailValue">
                                                ({Math.round(result.bbox.x1)},{Math.round(result.bbox.y1)},{Math.round(result.bbox.x2)},{Math.round(result.bbox.y2)})
                                            </span>
                                        </div>
                                        <div className="DetailRow">
                                            <span className="DetailLabel">{currentTexts.aiInference.results.size}:</span>
                                            <span className="DetailValue">
                                                {Math.round(result.bbox.width)} × {Math.round(result.bbox.height)}
                                            </span>
                                        </div>
                                        <div className="DetailRow">
                                            <span className="DetailLabel">{currentTexts.aiInference.results.area}:</span>
                                            <span className="DetailValue">{Math.round(result.mask.area)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : suggestedLabelList && suggestedLabelList.length > 0 ? (
                    <div className="ResultsList">
                        <div className="SectionTitle">{language === 'zh' ? '建议标签' : 'Suggested Labels'}</div>
                        {suggestedLabelList.map((label, index) => (
                            <div key={index} className="ResultItem">
                                <div className="ResultLabel">
                                    {label}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="EmptyResults">
                        <img 
                            src="/ico/brain.png" 
                            alt="AI" 
                            className="EmptyIcon"
                        />
                        <div className="EmptyText">
                            {currentTexts.aiInference.results.noResults}
                        </div>
                        <div className="EmptySubText">
                            {currentTexts.aiInference.results.noResultsHint}
                        </div>
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
