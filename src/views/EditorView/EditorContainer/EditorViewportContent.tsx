import React from 'react';
import {ISize} from '../../../interfaces/ISize';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {ImageData} from '../../../store/labels/types';
import {QueueItem, QueueItemType} from '../../../store/queue/types';
import CameraPlayer from '../CameraPlayer/CameraPlayer';
import VideoEditor from '../VideoEditor/VideoEditor';
import Editor from '../Editor/Editor';
import EditorBottomNavigationBar from '../EditorBottomNavigationBar/EditorBottomNavigationBar';
import {VideoImportProgress} from './EditorFileImport';

interface Props {
    activeQueueItem: QueueItem | null;
    language: Language;
    isVideoMode: boolean;
    imageData: ImageData | null;
    totalImageCount: number;
    size: ISize;
    videoProcessing: VideoImportProgress | null;
    isDragActive: boolean;
    openFileDialog: () => void;
}

export const EditorViewportContent: React.FC<Props> = ({
    activeQueueItem, language, isVideoMode, imageData, totalImageCount, size,
    videoProcessing, isDragActive, openFileDialog,
}) => {
    if (activeQueueItem?.type === QueueItemType.CAMERA) {
        return <CameraPlayer item={activeQueueItem} language={language} key={activeQueueItem.id}/>;
    }
    if (isVideoMode) return <VideoEditor editorSize={size} key='video-editor'/>;
    if (imageData) return <>
        <Editor size={size} imageData={imageData} key='editor'/>
        <EditorBottomNavigationBar imageData={imageData} size={size}
            totalImageCount={totalImageCount} key='editor-bottom-navigation-bar'/>
    </>;
    if (videoProcessing) return <div className='EmptyProjectView' style={{cursor: 'default'}}>
        <div className='EmptyProjectContent'>
            <div className='VideoProcessingOverlay'>
                <div className='ProcessingSpinner'></div>
                <h2>{videoProcessing.fileName}</h2>
                <p>{videoProcessing.phase}</p>
            </div>
        </div>
    </div>;
    const texts = LanguageConfig[language];
    return <div className={`EmptyProjectView ${isDragActive ? 'drag-active' : ''}`}
        onClick={openFileDialog} style={{cursor: 'pointer'}}>
        <div className='EmptyProjectContent'>
            <img draggable={false} alt='empty-project' src='ico/box-opened.png'/>
            <h2>{texts.welcomeTitle}</h2>
            <p>{isDragActive ? texts.dragActiveMessage : texts.welcomeDescription}</p>
        </div>
    </div>;
};
