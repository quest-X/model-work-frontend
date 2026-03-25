import React, {useState, useEffect} from 'react';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import './LoadModelPopup.scss'
import {updateActivePopupType as storeUpdateActivePopupType} from '../../../store/general/actionCreators';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {GeneralActionTypes} from '../../../store/general/types';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {StyledTextField} from '../../Common/StyledTextField/StyledTextField';

export interface YOLOModelFamily {
    id: string;
    name: string;
    variants: string[];
}

export const YOLO_MODEL_FAMILIES: YOLOModelFamily[] = [
    { id: 'yolo26', name: 'ultralytics/yolo26', variants: ['yolo26n', 'yolo26s', 'yolo26m', 'yolo26l', 'yolo26x'] },
    { id: 'yolo12', name: 'ultralytics/yolo12', variants: ['yolo12n', 'yolo12s', 'yolo12m', 'yolo12l', 'yolo12x'] },
    { id: 'yolo11', name: 'ultralytics/yolo11', variants: ['yolo11n', 'yolo11s', 'yolo11m', 'yolo11l', 'yolo11x'] },
    { id: 'yolov10', name: 'ultralytics/yolov10', variants: ['yolov10n', 'yolov10s', 'yolov10m', 'yolov10l', 'yolov10x'] },
    { id: 'yolov9', name: 'ultralytics/yolov9', variants: ['yolov9t', 'yolov9s', 'yolov9m', 'yolov9c', 'yolov9e'] },
    { id: 'yolov8', name: 'ultralytics/yolov8', variants: ['yolov8n', 'yolov8s', 'yolov8m', 'yolov8l', 'yolov8x'] },
];

// Module-level state shared between LoadModelPopup and LoadYOLOModelPopup
let _selectedModelFamily: YOLOModelFamily | null = null;
let _serverUrl: string = 'http://localhost:8000';

export const getSelectedModelFamily = (): YOLOModelFamily | null => _selectedModelFamily;
export const getServerUrl = (): string => _serverUrl;

interface IProps {
    updateActivePopupType: (activePopupType: PopupWindowType) => GeneralActionTypes;
    language: Language;
}

const LoadModelPopup: React.FC<IProps> = ({ updateActivePopupType, language }) => {
    const currentTexts = LanguageConfig[language];
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [serverUrl, setServerUrl] = useState(_serverUrl);

    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [currentModelName, setCurrentModelName] = useState<string>('');

    useEffect(() => {
        fetch(`${serverUrl}/available-models`)
            .then(r => r.json())
            .then(data => { if (data.models) setAvailableModels(data.models); })
            .catch(() => {});
        fetch(`${serverUrl}/health`)
            .then(r => r.json())
            .then(data => { if (data.model && data.model !== 'none') setCurrentModelName(data.model); })
            .catch(() => {});
    }, [serverUrl]);

    const getDownloadedCount = (family: YOLOModelFamily): number => {
        return family.variants.filter(v => availableModels.includes(v)).length;
    };

    const onSelect = (id: string) => {
        setSelectedId(selectedId === id ? null : id);
    };

    const onAccept = () => {
        const family = YOLO_MODEL_FAMILIES.find(f => f.id === selectedId);
        if (!family) return;
        _selectedModelFamily = family;
        _serverUrl = serverUrl;
        updateActivePopupType(PopupWindowType.LOAD_YOLO_V5_MODEL);
    };

    const onReject = () => {
        PopupActions.close();
    };

    const isActiveFamily = (family: YOLOModelFamily): boolean => {
        if (!currentModelName) return false;
        const baseName = currentModelName.replace('.pt', '');
        return family.variants.some(v => v === baseName);
    };

    const getOptions = () => {
        return YOLO_MODEL_FAMILIES.map((family) => {
            const isSelected = selectedId === family.id;
            const downloaded = getDownloadedCount(family);
            const total = family.variants.length;
            const isActive = isActiveFamily(family);
            return <div
                className={`OptionsItem${downloaded > 0 ? ' has-models' : ''}${isActive ? ' active-model' : ''}`}
                onClick={() => onSelect(family.id)}
                key={family.id}
            >
                <img
                    draggable={false}
                    src={isSelected ? 'ico/checkbox-checked.png' : 'ico/checkbox-unchecked.png'}
                    alt={isSelected ? 'checked' : 'unchecked'}
                />
                {family.name} - 检测模型
                {downloaded > 0 && <span className='model-count'> ({downloaded}/{total})</span>}
                {isActive && <span className='active-badge'>✓ {currentModelName.replace('.pt', '')}</span>}
            </div>
        })
    };

    const renderContent = () => {
        return <div className='LoadModelPopupContent'>
            <div className='Message'>
                {currentTexts.popups.loadModel.welcomeMessage}
            </div>
            <div className='Companion'>
                <div className='Options'>
                    {getOptions()}
                </div>
            </div>
            <div className='ServerConfig'>
                <StyledTextField
                    variant='standard'
                    id={'server-url'}
                    autoComplete={'off'}
                    type={'text'}
                    margin={'dense'}
                    label={'推理服务地址'}
                    value={serverUrl}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setServerUrl(e.target.value)}
                    style={{ width: 300 }}
                    InputLabelProps={{ shrink: true }}
                />
            </div>
        </div>
    };

    return (
        <GenericYesNoPopup
            title={currentTexts.popups.loadModel.title}
            renderContent={renderContent}
            acceptLabel={currentTexts.popups.loadModel.acceptButton}
            onAccept={onAccept}
            disableAcceptButton={!selectedId || serverUrl === ''}
            rejectLabel={currentTexts.popups.loadModel.rejectButton}
            onReject={onReject}
        />
    );
};

const mapDispatchToProps = {
    updateActivePopupType: storeUpdateActivePopupType
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(LoadModelPopup);
