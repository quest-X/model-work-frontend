import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {BatchStatisticsView} from '../BatchStatisticsView';
import {ImageDataUtil} from '../../../../utils/ImageDataUtil';
import {LabelUtil} from '../../../../utils/LabelUtil';
import {Language} from '../../../../data/LanguageConfig';

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
    view.rerender(<BatchStatisticsView language={Language.CHINESE} imagesData={[]} activeImageIndex={0} updateActiveImageIndex={select}/>);
    expect(screen.getByText('暂无推理结果')).toBeInTheDocument();
});
