import React from 'react';
import './LoadMoreImagesPopup.scss';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import { addImageData } from '../../../store/labels/actionCreators';
import { GenericYesNoPopup } from '../GenericYesNoPopup/GenericYesNoPopup';
import { useDropzone } from 'react-dropzone';
import { ImageData } from '../../../store/labels/types';
import { PopupActions } from '../../../logic/actions/PopupActions';
import { ImageDataUtil } from '../../../utils/ImageDataUtil';
import { Language, LanguageConfig } from '../../../data/LanguageConfig';
import { QueueItem, QueueItemType, QueueItemStatus } from '../../../store/queue/types';
import { addQueueItems } from '../../../store/queue/actionCreators';
import { QueueActions } from '../../../logic/actions/QueueActions';
import { v4 as uuidv4 } from 'uuid';
import { sortBy } from 'lodash';

interface IProps {
    addImageData: (imageData: ImageData[]) => any;
    addQueueItems: (items: QueueItem[]) => any;
    imagesData: ImageData[];
    language: Language;
}

const LoadMoreImagesPopup: React.FC<IProps> = ({ addImageData, addQueueItems, imagesData, language }) => {
    const currentTexts = LanguageConfig[language];
    const { acceptedFiles, getRootProps, getInputProps } = useDropzone({
        accept: {
            'image/*': ['.jpeg', '.jpg', '.png'],
            'video/*': ['.mp4', '.mov', '.avi', '.webm']
        }
    });

    // 生成缩略图
    const generateThumbnail = (file: File): Promise<string | undefined> => {
        return new Promise((resolve) => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        const maxSize = 100;
                        let width = img.width;
                        let height = img.height;
                        if (width > height) {
                            if (width > maxSize) { height *= maxSize / width; width = maxSize; }
                        } else {
                            if (height > maxSize) { width *= maxSize / height; height = maxSize; }
                        }
                        canvas.width = width;
                        canvas.height = height;
                        ctx?.drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL());
                    };
                    img.src = e.target?.result as string;
                };
                reader.readAsDataURL(file);
            } else if (file.type.startsWith('video/')) {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.onloadedmetadata = () => { video.currentTime = 0; };
                const videoUrl = URL.createObjectURL(file);
                video.onseeked = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const maxSize = 100;
                    let width = video.videoWidth;
                    let height = video.videoHeight;
                    if (width > height) {
                        if (width > maxSize) { height *= maxSize / width; width = maxSize; }
                    } else {
                        if (height > maxSize) { width *= maxSize / height; height = maxSize; }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    ctx?.drawImage(video, 0, 0, width, height);
                    URL.revokeObjectURL(videoUrl);
                    resolve(canvas.toDataURL());
                };
                video.onerror = () => { URL.revokeObjectURL(videoUrl); resolve(undefined); };
                video.src = videoUrl;
            } else {
                resolve(undefined);
            }
        });
    };

    const onAccept = async () => {
        if (acceptedFiles.length > 0) {
            const sortedFiles = sortBy(acceptedFiles, (item: File) => item.name);
            const imageFiles = sortedFiles.filter(file => file.type.startsWith('image/'));
            const videoFiles = sortedFiles.filter(file => file.type.startsWith('video/'));

            // 图像文件直接添加到当前项目
            if (imageFiles.length > 0) {
                addImageData(imageFiles.map((fileData: File) => ImageDataUtil.createImageDataFromFileData(fileData)));
            }

            // 视频文件添加到队列
            if (videoFiles.length > 0) {
                const newQueueItems: QueueItem[] = [];
                for (const videoFile of videoFiles) {
                    const thumbnail = await generateThumbnail(videoFile);
                    const item: QueueItem = {
                        id: uuidv4(),
                        name: videoFile.name,
                        type: QueueItemType.VIDEO,
                        file: videoFile,
                        status: QueueItemStatus.PENDING,
                        uploadedAt: Date.now(),
                        thumbnail
                    };
                    newQueueItems.push(item);
                }
                addQueueItems(newQueueItems);

                // 如果只上传了视频（没有图像），自动切换到第一个视频
                if (imageFiles.length === 0 && newQueueItems.length > 0) {
                    await QueueActions.switchToQueueItem(newQueueItems[0], imagesData);
                }
            }

            PopupActions.close();
        }
    };

    const onReject = () => {
        PopupActions.close();
    };

    const getDropZoneContent = () => {
        if (acceptedFiles.length === 0)
            return <>
                <input {...getInputProps()} />
                <img
                    draggable={false}
                    alt={'upload'}
                    src={'ico/box-opened.png'}
                />
                <p className='extraBold'>{currentTexts.popups.uploadFiles.addNewFiles}</p>
                <p>{currentTexts.or}</p>
                <p className='extraBold'>{currentTexts.popups.uploadFiles.clickToSelect}</p>
            </>;
        else if (acceptedFiles.length === 1)
            return <>
                <img
                    draggable={false}
                    alt={'uploaded'}
                    src={'ico/box-closed.png'}
                />
                <p className='extraBold'>{currentTexts.popups.uploadFiles.oneFileLoaded}</p>
            </>;
        else
            return <>
                <img
                    draggable={false}
                    key={1}
                    alt={'uploaded'}
                    src={'ico/box-closed.png'}
                />
                <p key={2} className='extraBold'>{currentTexts.popups.uploadFiles.multipleFilesLoaded.replace('{count}', acceptedFiles.length.toString())}</p>
            </>;
    };

    const renderContent = () => {
        return (<div className='LoadMoreImagesPopupContent'>
            <div {...getRootProps({ className: 'DropZone' })}>
                {getDropZoneContent()}
            </div>
        </div>);
    };

    return (
        <GenericYesNoPopup
            title={currentTexts.popups.uploadFiles.title}
            renderContent={renderContent}
            acceptLabel={currentTexts.popups.uploadFiles.loadButton}
            disableAcceptButton={acceptedFiles.length < 1}
            onAccept={onAccept}
            rejectLabel={currentTexts.popups.uploadFiles.cancelButton}
            onReject={onReject}
        />
    );
};

const mapDispatchToProps = {
    addImageData,
    addQueueItems
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
    imagesData: state.labels.imagesData
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(LoadMoreImagesPopup);
