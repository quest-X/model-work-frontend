import {updateActivePopupType} from '../../store/general/actionCreators';
import {PopupWindowType} from '../enums/PopupWindowType';
import {store} from '../../index';
import {Language, LanguageConfig} from '../LanguageConfig';

export type DropDownMenuNode = {
    name: string
    description?: string
    imageSrc: string
    imageAlt: string
    disabled: boolean
    onClick?: () => void
    children?: DropDownMenuNode[]
}

export const getDropDownMenuData = (language: Language): DropDownMenuNode[] => {
    const texts = LanguageConfig[language];
    
    return [
        {
            name: texts.actions.title,
            imageSrc: 'ico/actions.png',
            imageAlt: 'actions',
            disabled: false,
            children: [
                {
                    name: texts.actions.editLabels.name,
                    description: texts.actions.editLabels.description,
                    imageSrc: 'ico/tags.png',
                    imageAlt: 'labels',
                    disabled: false,
                    onClick: () => store.dispatch(updateActivePopupType(PopupWindowType.UPDATE_LABEL))
                },
                {
                    name: texts.actions.importImages.name,
                    description: texts.actions.importImages.description,
                    imageSrc: 'ico/camera.png',
                    imageAlt: 'images',
                    disabled: false,
                    onClick: () => store.dispatch(updateActivePopupType(PopupWindowType.IMPORT_IMAGES))
                },
                {
                    name: texts.actions.importAnnotations.name,
                    description: texts.actions.importAnnotations.description,
                    imageSrc: 'ico/import-labels.png',
                    imageAlt: 'import-labels',
                    disabled: false,
                    onClick: () => store.dispatch(updateActivePopupType(PopupWindowType.IMPORT_ANNOTATIONS))
                },
                {
                    name: texts.actions.exportAnnotations.name,
                    description: texts.actions.exportAnnotations.description,
                    imageSrc: 'ico/export-labels.png',
                    imageAlt: 'export-labels',
                    disabled: false,
                    onClick: () => store.dispatch(updateActivePopupType(PopupWindowType.EXPORT_ANNOTATIONS))
                },
                {
                    name: texts.actions.runAILocally.name,
                    description: texts.actions.runAILocally.description,
                    imageSrc: 'ico/ai.png',
                    imageAlt: 'load-ai-model-in-browser',
                    disabled: false,
                    onClick: () => store.dispatch(updateActivePopupType(PopupWindowType.LOAD_AI_MODEL))
                },
            ]
        }
        // Community 部分已移除
    ];
};

// 保持向后兼容性，默认使用英文
export const DropDownMenuData: DropDownMenuNode[] = getDropDownMenuData(Language.ENGLISH);

