import React, {useMemo} from 'react';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {ImageData} from '../../../store/labels/types';
import {Language} from '../../../data/LanguageConfig';
import {updateActiveImageIndex as updateActiveImageIndexAction} from '../../../store/labels/actionCreators';
import './BatchStatisticsView.scss';

interface ImageStat {
    index: number;
    name: string;
    detCount: number;
    avgConf: number;      // 0-1, NaN if no detections
    confidences: number[];
}

interface IProps {
    language: Language;
    imagesData: ImageData[];
    activeImageIndex: number;
    updateActiveImageIndex: (index: number) => any;
}

const getConfColor = (conf: number): string => {
    if (conf >= 0.8) return '#4caf50';
    if (conf >= 0.6) return '#ff9800';
    return '#f44336';
};

const pct = (value: number): string => isNaN(value) ? '--' : `${(value * 100).toFixed(1)}%`;

const ConfidenceRow: React.FC<{
    label: string; confidence: number; imageIndex?: number; jumpTitle: string;
    onSelect: (index: number) => void;
}> = ({label, confidence, imageIndex, jumpTitle, onSelect}) => {
    const clickable = imageIndex !== undefined;
    return <div className="ConfidenceRow">
        <span className="ConfLabel">{label}</span>
        <span className={clickable ? 'ConfValue clickable' : 'ConfValue'}
            style={{color: isNaN(confidence) ? '#666' : getConfColor(confidence),
                ...(clickable ? {cursor: imageIndex >= 0 ? 'pointer' : 'default'} : {})}}
            onClick={clickable ? () => imageIndex >= 0 && onSelect(imageIndex) : undefined}
            title={clickable ? (imageIndex >= 0 ? jumpTitle : '') : undefined}>
            {pct(confidence)}
        </span>
    </div>;
};

const DetectionOverview: React.FC<{
    zh: boolean; detectionRate: number; detectedImages: number; totalImages: number; totalDetections: number;
}> = ({zh, detectionRate, detectedImages, totalImages, totalDetections}) => (
    <div className="SummarySection">
        <div className="SummaryTitle">{zh ? '检出概况' : 'DETECTION OVERVIEW'}</div>
        <div className="SummaryGrid">
            <div className="StatItemWide">
                <span className={`StatValue ${detectionRate >= 0.8 ? 'highlight' : ''}`}>
                    {(detectionRate * 100).toFixed(1)}%
                </span>
                <span className="StatSub">
                    {zh
                        ? `${detectedImages}/${totalImages} 张检出`
                        : `${detectedImages}/${totalImages} detected`}
                </span>
            </div>
            <div className="StatItem">
                <span className="StatLabel">{zh ? '总检出数' : 'Total Objects'}</span>
                <span className="StatValue">{totalDetections}</span>
            </div>
            <div className="StatItem">
                <span className="StatLabel">{zh ? '图均检出' : 'Avg/Image'}</span>
                <span className="StatValue">
                    {detectedImages > 0 ? (totalDetections / detectedImages).toFixed(1) : '0'}
                </span>
            </div>
        </div>
    </div>
);

function getConfidenceSummary(allConfs: number[]) {
    const avgConf = allConfs.length > 0 ? allConfs.reduce((a, b) => a + b, 0) / allConfs.length : NaN;
    const maxConf = allConfs.length > 0 ? Math.max(...allConfs) : NaN;
    const minConf = allConfs.length > 0 ? Math.min(...allConfs) : NaN;

    return {avgConf, maxConf, minConf};
}

export const BatchStatisticsView: React.FC<IProps> = ({language, imagesData, activeImageIndex, updateActiveImageIndex}) => {
    const zh = language === 'zh';

    const imageStats: ImageStat[] = useMemo(() => {
        return imagesData.map((img, idx) => {
            const aiRects = img.labelRects.filter(r => r.isCreatedByAI);
            const aiPolygons = img.labelPolygons.filter(p => p.isCreatedByAI);
            const rectConfs = aiRects.map(r => r.confidence ?? 0);
            const polyConfs = aiPolygons.map(p => p.confidence ?? 0);
            const confidences = [...rectConfs, ...polyConfs];
            const detCount = aiRects.length + aiPolygons.length;
            const avg = confidences.length > 0
                ? confidences.reduce((a, b) => a + b, 0) / confidences.length
                : NaN;
            return {
                index: idx,
                name: img.fileData.name,
                detCount,
                avgConf: avg,
                confidences,
            };
        });
    }, [imagesData]);

    const totalImages = imageStats.length;
    const detectedImages = imageStats.filter(s => s.detCount > 0).length;
    const detectionRate = totalImages > 0 ? detectedImages / totalImages : 0;
    const totalDetections = imageStats.reduce((sum, s) => sum + s.detCount, 0);

    const allConfs = useMemo(() => {
        const arr: number[] = [];
        for (const s of imageStats) arr.push(...s.confidences);
        return arr;
    }, [imageStats]);

    const {avgConf, maxConf, minConf} = getConfidenceSummary(allConfs);

    // 找到最高/最低置信度对应的图像索引
    const maxConfImageIdx = useMemo(() => {
        let best = -1, bestVal = -1;
        for (const s of imageStats) {
            for (const c of s.confidences) {
                if (c > bestVal) { bestVal = c; best = s.index; }
            }
        }
        return best;
    }, [imageStats]);

    const minConfImageIdx = useMemo(() => {
        let best = -1, bestVal = Infinity;
        for (const s of imageStats) {
            for (const c of s.confidences) {
                if (c < bestVal) { bestVal = c; best = s.index; }
            }
        }
        return best;
    }, [imageStats]);


    if (totalDetections === 0) {
        return (
            <div className="BatchStatisticsView">
                <div className="Header">{zh ? '统计' : 'Statistics'}</div>
                <div className="Content">
                    <div className="EmptyResults">
                        <img src="/ico/brain.png" alt="AI" className="EmptyIcon"/>
                        <div className="EmptyText">{zh ? '暂无推理结果' : 'No inference results yet'}</div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="BatchStatisticsView">
            <div className="Header">{zh ? '统计' : 'Statistics'}</div>
            <div className="Content">
                {/* Detection rate */}
                <DetectionOverview zh={zh} detectionRate={detectionRate} detectedImages={detectedImages}
                    totalImages={totalImages} totalDetections={totalDetections}/>

                {/* Confidence stats */}
                <div className="ConfidenceSection">
                    <div className="SummaryTitle">{zh ? '置信度' : 'CONFIDENCE'}</div>
                    <ConfidenceRow label={zh ? '平均' : 'Average'} confidence={avgConf}
                        jumpTitle="" onSelect={updateActiveImageIndex}/>
                    <ConfidenceRow label={zh ? '最高' : 'Highest'} confidence={maxConf} imageIndex={maxConfImageIdx}
                        jumpTitle={zh ? '跳转到该图像' : 'Jump to image'} onSelect={updateActiveImageIndex}/>
                    <ConfidenceRow label={zh ? '最低' : 'Lowest'} confidence={minConf} imageIndex={minConfImageIdx}
                        jumpTitle={zh ? '跳转到该图像' : 'Jump to image'} onSelect={updateActiveImageIndex}/>

                </div>

                {/* Per-image distribution */}
                <div className="DistributionSection">
                    <div className="SummaryTitle">
                        {zh ? '逐图置信度分布' : 'PER-IMAGE CONFIDENCE'}
                    </div>
                    {imageStats.map(stat => {
                        const hasDetection = stat.detCount > 0;
                        const conf = hasDetection ? stat.avgConf : 0;
                        const isActive = stat.index === activeImageIndex;
                        return (
                            <div
                                key={stat.index}
                                className={`ImageRow ${isActive ? 'active' : ''} ${!hasDetection ? 'noDetection' : ''}`}
                                onClick={() => updateActiveImageIndex(stat.index)}
                                title={stat.name}
                            >
                                <span className="ImageName">{stat.name}</span>
                                <span className="DetCount">
                                    {hasDetection ? `x${stat.detCount}` : ''}
                                </span>
                                <div className="BarContainer">
                                    {hasDetection && (
                                        <div
                                            className="Bar"
                                            style={{
                                                width: `${conf * 100}%`,
                                                backgroundColor: getConfColor(conf),
                                            }}
                                        />
                                    )}
                                </div>
                                <span className="ConfText" style={{color: hasDetection ? getConfColor(conf) : undefined}}>
                                    {hasDetection ? pct(conf) : '--'}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
    imagesData: state.labels.imagesData,
    activeImageIndex: state.labels.activeImageIndex,
});

const mapDispatchToProps = {
    updateActiveImageIndex: updateActiveImageIndexAction,
};

export default connect(mapStateToProps, mapDispatchToProps)(BatchStatisticsView);
