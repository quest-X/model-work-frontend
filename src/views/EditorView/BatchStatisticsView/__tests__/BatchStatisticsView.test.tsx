import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {BatchStatisticsView} from '../BatchStatisticsView';
import {ImageDataUtil} from '../../../../utils/ImageDataUtil';
import {LabelUtil} from '../../../../utils/LabelUtil';
import {Language} from '../../../../data/LanguageConfig';
import {VideoData} from '../../../../store/video/types';

const scroll = jest.fn();
beforeAll(() => {Element.prototype.scrollIntoView = scroll;});
beforeEach(() => scroll.mockClear());

it('counts both AI geometry types and keeps confidence jumps attached to their image', () => {
    const low = ImageDataUtil.createImageDataFromFileData(new File(['low'], 'low.png'));
    const high = ImageDataUtil.createImageDataFromFileData(new File(['high'], 'high.png'));
    low.labelRects = [{...LabelUtil.createLabelRect(null, {x: 0, y: 0, width: 10, height: 10}), isCreatedByAI: true, confidence: 0.2}];
    high.labelPolygons = [{...LabelUtil.createLabelPolygon(null, [{x: 0, y: 0}, {x: 10, y: 10}]), isCreatedByAI: true, confidence: 0.9}];
    const select = jest.fn();
    const view = render(<BatchStatisticsView language={Language.ENGLISH} imagesData={[low, high]} activeImageIndex={0} updateActiveImageIndex={select}/>);
    expect(screen.getByText('100.0%')).toBeInTheDocument();
    expect(screen.getByText('55.0%')).toBeInTheDocument();
    const links = screen.getAllByTitle('Jump to image');
    fireEvent.click(links[0]);
    fireEvent.click(links[1]);
    expect(select.mock.calls).toEqual([[1], [0]]);
    expect(scroll).toHaveBeenCalledWith({block: 'center'});
    view.rerender(<BatchStatisticsView language={Language.CHINESE} imagesData={[]} activeImageIndex={0} updateActiveImageIndex={select}/>);
    expect(screen.getByText('暂无推理结果')).toBeInTheDocument();
});

it('pauses and seeks the exact fractional-rate video frame when selecting a statistics row', () => {
    const images = [0, 1].map(index => ImageDataUtil.createImageDataFromFileData(new File(['frame'], `${index}.jpg`)));
    images[1].labelRects = [{...LabelUtil.createLabelRect(null, {x: 0, y: 0, width: 10, height: 10}),
        isCreatedByAI: true, confidence: 0.2582}];
    const pause = jest.fn(), seek = jest.fn(), select = jest.fn();
    render(<BatchStatisticsView language={Language.CHINESE} imagesData={images} activeImageIndex={0}
        activeVideo={{id: 'playing-video', fps: 30000 / 1001, isPlaying: true} as VideoData}
        updateVideoPlayingStatus={pause} updateVideoCurrentFrame={seek} updateActiveImageIndex={select}/>);
    fireEvent.click(screen.getByTitle('1.jpg'));
    expect(pause).toHaveBeenCalledWith('playing-video', false);
    expect(seek).toHaveBeenCalledWith('playing-video', 1, 1001 / 30000);
    expect(select).toHaveBeenCalledWith(1);
});

it('shows unrecorded confidence instead of a misleading 0% for external model boxes', () => {
    const image = ImageDataUtil.createImageDataFromFileData(new File(['frame'], 'frame_000516.jpg'));
    image.labelRects = [{...LabelUtil.createLabelRect(null, {x: 0, y: 0, width: 10, height: 10}),
        isCreatedByAI: true, confidence: undefined, annotationSource: 'DeepSeek',
        annotationModel: 'deepseek-v4.1-flash-1017'}];
    render(<BatchStatisticsView language={Language.CHINESE} imagesData={[image]} activeImageIndex={0}
        updateActiveImageIndex={jest.fn()}/>);

    expect(screen.getByText('deepseek-v4.1-flash-1017')).toBeInTheDocument();
    expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
});

it('averages only recorded confidence values when some boxes have none', () => {
    const recorded = ImageDataUtil.createImageDataFromFileData(new File(['recorded'], 'recorded.png'));
    const missing = ImageDataUtil.createImageDataFromFileData(new File(['missing'], 'missing.png'));
    recorded.labelRects = [{...LabelUtil.createLabelRect(null, {x: 0, y: 0, width: 10, height: 10}),
        isCreatedByAI: true, confidence: 0.8}];
    missing.labelRects = [{...LabelUtil.createLabelRect(null, {x: 0, y: 0, width: 10, height: 10}),
        isCreatedByAI: true, confidence: undefined, annotationSource: 'GLM',
        annotationModel: 'glm-5.3-flash'}];
    render(<BatchStatisticsView language={Language.CHINESE} imagesData={[recorded, missing]} activeImageIndex={0}
        updateActiveImageIndex={jest.fn()}/>);

    expect(screen.getAllByText('80.0%').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('40.0%')).not.toBeInTheDocument();
    expect(screen.getByText('glm-5.3-flash')).toBeInTheDocument();
});

it('hides Sigine review guidance while keeping its stored results', () => {
    const image = ImageDataUtil.createImageDataFromFileData(new File(['frame'], 'frame_000000.jpg'));
    const select = jest.fn();
    const reviews = JSON.stringify({0: {
        needs_correction: true, reason: '漏检 dog', suggested_boxes: [{label: 'dog', bbox: [100, 200, 700, 900]}],
    }});
    sessionStorage.setItem('opensight.annotation.sigineReviews', reviews);
    const view = render(<BatchStatisticsView language={Language.CHINESE} imagesData={[image]}
        activeImageIndex={0} updateActiveImageIndex={select}/>);
    expect(screen.queryByText(/Sigine GPT 复审建议/)).not.toBeInTheDocument();
    expect(screen.queryByText(/漏检 dog/)).not.toBeInTheDocument();
    expect(screen.getByText('暂无推理结果')).toBeInTheDocument();
    image.labelRects = [{...LabelUtil.createLabelRect(null, {x: 0, y: 0, width: 10, height: 10}),
        isCreatedByAI: true, confidence: 0.8}];
    view.rerender(<BatchStatisticsView language={Language.CHINESE} imagesData={[image]}
        activeImageIndex={0} updateActiveImageIndex={select}/>);
    expect(screen.getByText('检出概况')).toBeInTheDocument();
    expect(screen.queryByText(/Sigine GPT 复审建议/)).not.toBeInTheDocument();
    expect(sessionStorage.getItem('opensight.annotation.sigineReviews')).toBe(reviews);
    sessionStorage.removeItem('opensight.annotation.sigineReviews');
});
