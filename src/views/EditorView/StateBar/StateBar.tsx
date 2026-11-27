import React, {useMemo} from 'react';
import './StateBar.scss';
import {ImageData} from '../../../store/labels/types';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {computeAnnotationProgress} from './annotationProgress';

interface IProps {
    imagesData: ImageData[];
    activeImageIndex: number;
}

export const StateBar: React.FC<IProps> = ({imagesData, activeImageIndex}) => {
    // 进度针对当前这张图：前半段表示是否已有标注，后半段表示标注是否都给了标签。
    const progress = useMemo(() => {
        const activeImage = imagesData[activeImageIndex];
        return computeAnnotationProgress(activeImage ? [activeImage] : []);
    }, [imagesData, activeImageIndex]);
    const label = progress.totalImages === 0
        ? '暂无图片'
        : `${Math.round(progress.percent)}% · ${progress.labeledShapes}/${progress.totalShapes} 个标签`
            + (progress.complete ? ' · 已完成' : '');

    return (
        <div className='StateBar' role='progressbar'
            aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(progress.percent)}
            aria-label={label}
            title={label}
        >
            <div
                className={progress.complete ? 'done complete' : 'done'}
                style={{width: `${progress.percent}%`}}
            />
        </div>
    );
};

const mapDispatchToProps = {};

const mapStateToProps = (state: AppState) => ({
    imagesData: state.labels.imagesData,
    activeImageIndex: state.labels.activeImageIndex,
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(StateBar);
