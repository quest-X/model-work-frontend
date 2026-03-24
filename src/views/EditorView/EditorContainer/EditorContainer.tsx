import React, {useState, useEffect} from 'react';
import {connect} from 'react-redux';
import {Direction} from '../../../data/enums/Direction';
import {ISize} from '../../../interfaces/ISize';
import {Settings} from '../../../settings/Settings';
import {AppState} from '../../../store';
import {ImageData} from '../../../store/labels/types';
import ImagesList from '../SideNavigationBar/ImagesList/ImagesList';
import LabelsToolkit from '../SideNavigationBar/LabelsToolkit/LabelsToolkit';
import {SideNavigationBar} from '../SideNavigationBar/SideNavigationBar';
import {VerticalEditorButton} from '../VerticalEditorButton/VerticalEditorButton';
import './EditorContainer.scss';
import Editor from '../Editor/Editor';
import {ContextManager} from '../../../logic/context/ContextManager';
import {ContextType} from '../../../data/enums/ContextType';
import EditorBottomNavigationBar from '../EditorBottomNavigationBar/EditorBottomNavigationBar';
import EditorTopNavigationBar from '../EditorTopNavigationBar/EditorTopNavigationBar';
import {ProjectType} from '../../../data/enums/ProjectType';
import {useDropzone, DropzoneOptions} from 'react-dropzone';
import {addImageData, updateActiveImageIndex} from '../../../store/labels/actionCreators';
import {updateActivePopupType} from '../../../store/general/actionCreators';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {ImageDataUtil} from '../../../utils/ImageDataUtil';
import {sortBy} from 'lodash';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import SelectAllButton from '../SelectAllButton/SelectAllButton';
import {AutoSaveService} from '../../../services/AutoSaveService';

interface IProps {
    windowSize: ISize;
    activeImageIndex: number;
    imagesData: ImageData[];
    activeContext: ContextType;
    projectType: ProjectType;
    language: Language;
    addImageDataAction: (imageData: ImageData[]) => any;
    updateActiveImageIndexAction: (activeImageIndex: number) => any;
    updateActivePopupTypeAction: (activePopupType: PopupWindowType) => any;
}

const EditorContainer: React.FC<IProps> = (
    {
        windowSize,
        activeImageIndex,
        imagesData,
        activeContext,
        projectType,
        language,
        addImageDataAction,
        updateActiveImageIndexAction,
        updateActivePopupTypeAction
    }) => {
    const [leftTabStatus, setLeftTabStatus] = useState(true);
    const [rightTabStatus, setRightTabStatus] = useState(true);

    const currentTexts = LanguageConfig[language];


    // Debounce auto-save on any label data change
    useEffect(() => {
        if (imagesData.length === 0) return;
        const timeoutId = setTimeout(() => {
            AutoSaveService.saveCurrentState();
        }, 1000);
        return () => clearTimeout(timeoutId);
    }, [imagesData, activeImageIndex, language]);

    // 拖拽上传功能
    const {acceptedFiles, getRootProps, getInputProps, isDragActive} = useDropzone({
        accept: {
            'image/*': ['.jpeg', '.png']
        },
        onDrop: (files) => {
            if (files.length > 0) {
                const sortedFiles = sortBy(files, (item: File) => item.name);
                updateActiveImageIndexAction(0);
                addImageDataAction(sortedFiles.map((file: File) => ImageDataUtil.createImageDataFromFileData(file)));
                updateActivePopupTypeAction(PopupWindowType.INSERT_LABEL_NAMES);
                
                // 上传图片后立即触发保存
                setTimeout(() => {
                    AutoSaveService.saveCurrentState();
                }, 500);
            }
        }
    } as DropzoneOptions);

    const calculateEditorSize = (): ISize => {
        if (windowSize) {
            const leftTabWidth = leftTabStatus ? Settings.SIDE_NAVIGATION_BAR_WIDTH_OPEN_PX : Settings.SIDE_NAVIGATION_BAR_WIDTH_CLOSED_PX;
            const rightTabWidth = rightTabStatus ? Settings.SIDE_NAVIGATION_BAR_WIDTH_OPEN_PX : Settings.SIDE_NAVIGATION_BAR_WIDTH_CLOSED_PX;
            return {
                width: windowSize.width - leftTabWidth - rightTabWidth,
                height: windowSize.height - Settings.TOP_NAVIGATION_BAR_HEIGHT_PX
                    - Settings.EDITOR_BOTTOM_NAVIGATION_BAR_HEIGHT_PX - Settings.EDITOR_TOP_NAVIGATION_BAR_HEIGHT_PX,
            }
        }
        else
            return null;
    };

    const leftSideBarButtonOnClick = () => {
        if (!leftTabStatus)
            ContextManager.switchCtx(ContextType.LEFT_NAVBAR);
        else if (leftTabStatus && activeContext === ContextType.LEFT_NAVBAR)
            ContextManager.restoreCtx();

        setLeftTabStatus(!leftTabStatus);
    };

    const leftSideBarCompanionRender = () => {
        return <>
            <VerticalEditorButton
                label={currentTexts.images}
                image={'/ico/camera.png'}
                imageAlt={'images'}
                onClick={leftSideBarButtonOnClick}
                isActive={leftTabStatus}
            />
            <SelectAllButton />
            <div className='VersionWatermark'>v1.0.0(S)</div>
        </>
    };

    const leftSideBarRender = () => {
        return <ImagesList/>
    };

    const rightSideBarButtonOnClick = () => {
        if (!rightTabStatus) {
            setRightTabStatus(true);
            ContextManager.switchCtx(ContextType.RIGHT_NAVBAR);
        } else if (rightTabStatus) {
            setRightTabStatus(false);
            ContextManager.restoreCtx();
        }
    };

    const rightSideBarCompanionRender = () => {
        return <>
            <VerticalEditorButton
                label={currentTexts.labels}
                image={'/ico/tags.png'}
                imageAlt={'labels'}
                onClick={rightSideBarButtonOnClick}
                isActive={rightTabStatus}
            />
        </>
    };

    const rightSideBarRender = () => {
        return <LabelsToolkit/>
    };

    return (
        <div className='EditorContainer'>
            <SideNavigationBar
                direction={Direction.LEFT}
                isOpen={leftTabStatus}
                isWithContext={activeContext === ContextType.LEFT_NAVBAR}
                renderCompanion={leftSideBarCompanionRender}
                renderContent={leftSideBarRender}
                key='left-side-navigation-bar'
            />
            <div className='EditorWrapper'
                onMouseDown={() => ContextManager.switchCtx(ContextType.EDITOR)}
                 key='editor-wrapper'
            >
                {projectType === ProjectType.OBJECT_DETECTION && <EditorTopNavigationBar
                    key='editor-top-navigation-bar'
                />}
                {imagesData.length > 0 && activeImageIndex < imagesData.length && imagesData[activeImageIndex] ? (
                    <>
                        <Editor
                            size={calculateEditorSize()}
                            imageData={imagesData[activeImageIndex]}
                            key='editor'
                        />
                        <EditorBottomNavigationBar
                            imageData={imagesData[activeImageIndex]}
                            size={calculateEditorSize()}
                            totalImageCount={imagesData.length}
                            key='editor-bottom-navigation-bar'
                        />
                    </>
                ) : (
                    <div {...getRootProps({className: `EmptyProjectView ${isDragActive ? 'drag-active' : ''}`})}>
                        <input {...getInputProps()} />
                        <div className='EmptyProjectContent'>
                            <img
                                draggable={false}
                                alt={'empty-project'}
                                src={'ico/box-opened.png'}
                            />
                            <h2>{currentTexts.welcomeTitle}</h2>
                            <p>{isDragActive ? currentTexts.dragActiveMessage : currentTexts.welcomeDescription}</p>
                            {/* <div className='UploadHint'>
                                <p>• 支持拖拽上传图像文件</p>
                                <p>• 支持 JPEG、PNG 格式</p>
                                <p>• 可以批量上传多张图像</p>
                            </div> */}
                        </div>
                    </div>
                )}
            </div>
            <SideNavigationBar
                direction={Direction.RIGHT}
                isOpen={rightTabStatus}
                isWithContext={activeContext === ContextType.RIGHT_NAVBAR}
                renderCompanion={rightSideBarCompanionRender}
                renderContent={rightSideBarRender}
                key='right-side-navigation-bar'
            />
        </div>
    );
};

const mapDispatchToProps = {
    addImageDataAction: addImageData,
    updateActiveImageIndexAction: updateActiveImageIndex,
    updateActivePopupTypeAction: updateActivePopupType
};

const mapStateToProps = (state: AppState) => ({
    windowSize: state.general.windowSize,
    activeImageIndex: state.labels.activeImageIndex,
    imagesData: state.labels.imagesData,
    activeContext: state.general.activeContext,
    projectType: state.general.projectData.type,
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditorContainer);