import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {PopupWindowType} from '../../../../data/enums/PopupWindowType';
import {Language} from '../../../../data/LanguageConfig';
import {AIModel} from '../../../../store/aimodels/types';
import {ManageAIModelsPopup} from '../ManageAIModelsPopup';

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent}: {title: React.ReactNode; renderContent: () => React.ReactNode}) => (
        <div><h1>{title}</h1>{renderContent()}</div>
    ),
}));

jest.mock('../../../Common/ImageButton/ImageButton', () => ({
    ImageButton: ({imageAlt, onClick}: {imageAlt: string; onClick: () => void}) => (
        <button type='button' aria-label={imageAlt} onClick={onClick}/>
    ),
}));

const createEngine = (modelType: AIModel['modelType']): AIModel => ({
    id: `${modelType}-engine`,
    name: modelType === 'core' ? '核心引擎' : '拓展引擎',
    url: `http://localhost/${modelType}`,
    modelType,
    createdAt: new Date('2026-08-20T00:00:00Z'),
    isActive: true,
});

const renderPopup = (engine: AIModel, commercialRestricted?: boolean) => {
    const updateActivePopupTypeAction = jest.fn();
    render(
        <ManageAIModelsPopup
            updateActivePopupTypeAction={updateActivePopupTypeAction}
            addAIModelAction={jest.fn()}
            setActiveAIModelAction={jest.fn()}
            deleteAIModelAction={jest.fn()}
            aiModels={[engine]}
            activeModelId={engine.id}
            language={Language.CHINESE}
            commercialRestricted={commercialRestricted}
        />
    );
    return updateActivePopupTypeAction;
};

describe('ManageAIModelsPopup provided services', () => {
    it.each([
        ['core', '资源中心'],
        ['core', '推理系统'],
        ['core', '训练系统'],
        ['core', '任务中心'],
        ['extension', '向量数据库'],
        ['extension', '视觉检索'],
        ['extension', '透视'],
    ] as const)('blocks the restricted %s service %s', (type, name) => {
        const updatePopup = renderPopup(createEngine(type), true);
        const button = screen.getByRole('button', {name, exact: true});
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', '暂未开放');
        fireEvent.click(button);
        expect(updatePopup).not.toHaveBeenCalled();
    });

    it('keeps engine setup and released extension services available', () => {
        const updatePopup = renderPopup(createEngine('extension'), true);
        fireEvent.click(screen.getByRole('button', {name: 'add', exact: true}));
        expect(updatePopup).toHaveBeenLastCalledWith(PopupWindowType.MODEL_ENGINE);
        fireEvent.click(screen.getByRole('button', {name: '连接相机', exact: true}));
        expect(updatePopup).toHaveBeenLastCalledWith(PopupWindowType.CAMERA_CONNECT);
        fireEvent.click(screen.getByRole('button', {name: '计算群', exact: true}));
        expect(updatePopup).toHaveBeenLastCalledWith(PopupWindowType.COMPUTE_CLUSTER);
    });

    it('shows concrete core service names and opens their actual popups', () => {
        const updatePopup = renderPopup(createEngine('core'));

        expect(screen.getByRole('button', {name: '资源中心'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '推理系统'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '训练系统'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '任务中心'})).toBeInTheDocument();
        expect(screen.queryByText('ultralytics/yolo26')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '资源中心'}));
        expect(updatePopup).toHaveBeenCalledWith(PopupWindowType.DATA_CENTER);
    });

    it('shows every concrete extension service and opens compute cluster', () => {
        const updatePopup = renderPopup(createEngine('extension'));

        expect(screen.getByRole('button', {name: '向量数据库'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '视觉检索'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '透视'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '连接相机'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '计算群'})).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '计算群'}));
        expect(updatePopup).toHaveBeenCalledWith(PopupWindowType.COMPUTE_CLUSTER);
    });

    it('opens task center as a popup', () => {
        const updatePopup = renderPopup(createEngine('core'));

        fireEvent.click(screen.getByRole('button', {name: '任务中心'}));
        expect(updatePopup).toHaveBeenCalledWith(PopupWindowType.TASK_CENTER);
    });
});
