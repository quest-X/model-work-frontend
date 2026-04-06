import React from 'react';
import { connect } from 'react-redux';
import classNames from 'classnames';
import { AppState } from '../../../../store';
import { QueueItem, QueueItemType, QueueItemStatus } from '../../../../store/queue/types';
import { ImageData } from '../../../../store/labels/types';
import { removeQueueItem } from '../../../../store/queue/actionCreators';
import { updateImageData } from '../../../../store/labels/actionCreators';
import { QueueActions } from '../../../../logic/actions/QueueActions';
import { ImageRepository } from '../../../../logic/imageRepository/ImageRepository';
import {Language, LanguageConfig, LanguageTexts} from '../../../../data/LanguageConfig';
import './QueueList.scss';

// ============ QueueItemCard ============

interface CardProps {
    item: QueueItem;
    isActive: boolean;
    language: Language;
    onSelect: (item: QueueItem) => void;
    onDelete: (itemId: string) => void;
}

const typeIconMap: Record<QueueItemType, string> = {
    [QueueItemType.VIDEO]: '/ico/pictures.png',
    [QueueItemType.IMAGE]: '/ico/camera.png',
    [QueueItemType.FOLDER]: '/ico/files.png',
};

// Strip legacy metadata suffix baked into item.name (e.g. " (174 帧 @ 30fps)" or " (174张图像)")
const stripMetaSuffix = (name: string): string => name.replace(/\s*\([\d]+(张图像| 帧 @ [\d.]+fps| frames @ [\d.]+fps| images)\)$/, '');

const getDisplayName = (item: QueueItem, texts: LanguageTexts): string => {
    const baseName = stripMetaSuffix(item.name);
    if (item.type === QueueItemType.VIDEO && item.extractionMetadata) {
        const meta = texts.videoMeta
            .replace('{frames}', String(item.extractionMetadata.totalFrames))
            .replace('{fps}', String(item.extractionMetadata.fps));
        return `${baseName} (${meta})`;
    }
    if (item.type === QueueItemType.FOLDER && item.files) {
        const meta = texts.folderMeta.replace('{count}', String(item.files.length));
        return `${baseName} (${meta})`;
    }
    return baseName;
};

const QueueItemCard: React.FC<CardProps> = ({ item, isActive, language, onSelect, onDelete }) => {
    const texts = LanguageConfig[language];
    const displayName = getDisplayName(item, texts);
    const statusLabels: Record<QueueItemStatus, { className: string; label: string }> = {
        [QueueItemStatus.PENDING]:    { className: 'status-pending',    label: texts.queueStatus.pending },
        [QueueItemStatus.PROCESSING]: { className: 'status-processing', label: texts.queueStatus.processing },
        [QueueItemStatus.COMPLETED]:  { className: 'status-completed',  label: texts.queueStatus.completed },
        [QueueItemStatus.ERROR]:      { className: 'status-error',      label: texts.queueStatus.error },
    };
    const statusInfo = statusLabels[item.status];

    return (
        <div
            className={classNames('queue-item-card', { 'active': isActive })}
            onClick={() => onSelect(item)}
            title={item.error || displayName}
        >
            <div className='card-thumbnail'>
                {item.thumbnail ? (
                    <img src={item.thumbnail} alt={displayName} draggable={false} />
                ) : (
                    <img
                        className='type-icon-fallback'
                        src={typeIconMap[item.type]}
                        alt={item.type}
                        draggable={false}
                    />
                )}
                <img
                    className='type-badge'
                    src={typeIconMap[item.type]}
                    alt={item.type}
                    draggable={false}
                />
            </div>

            <div className='card-info'>
                <span className='card-name'>{displayName}</span>
                <span className={classNames('card-status', statusInfo.className)}>
                    {statusInfo.label}
                </span>
            </div>

            <div
                className='card-delete-btn'
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item.id);
                }}
                title={texts.delete}
            >
                ✕
            </div>
        </div>
    );
};

// ============ QueueList ============

interface IProps {
    items: QueueItem[];
    activeQueueItemId: string | null;
    imagesData: ImageData[];
    language: Language;
    removeQueueItemAction: (itemId: string) => any;
    updateImageDataAction: (imageData: ImageData[]) => any;
}

const QueueList: React.FC<IProps> = ({
    items,
    activeQueueItemId,
    imagesData,
    language,
    removeQueueItemAction,
    updateImageDataAction,
}) => {
    const texts = LanguageConfig[language];
    const handleItemSelect = (item: QueueItem) => {
        if (item.id === activeQueueItemId) return;
        if (item.status === QueueItemStatus.PROCESSING) return;
        QueueActions.switchToQueueItem(item, imagesData);
    };

    const handleItemDelete = (itemId: string) => {
        if (itemId === activeQueueItemId) {
            ImageRepository.clearCurrentDisplay();
            updateImageDataAction([]);
        }
        removeQueueItemAction(itemId);
    };

    return (
        <div className='queue-list'>
            {items.length === 0 ? (
                <div className='queue-list-empty'>
                    <img src='/ico/box-opened.png' alt='empty' draggable={false} />
                    <p>{texts.queueEmpty}</p>
                    <p className='queue-list-empty-hint'>{texts.queueEmptyHint}</p>
                </div>
            ) : (
                <div className='queue-list-scroll'>
                    {items.map(item => (
                        <QueueItemCard
                            key={item.id}
                            item={item}
                            isActive={item.id === activeQueueItemId}
                            language={language}
                            onSelect={handleItemSelect}
                            onDelete={handleItemDelete}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    items: state.queue?.items || [],
    activeQueueItemId: state.queue?.activeQueueItemId || null,
    imagesData: state.labels.imagesData,
    language: state.general.language,
});

const mapDispatchToProps = {
    removeQueueItemAction: removeQueueItem,
    updateImageDataAction: updateImageData,
};

export default connect(mapStateToProps, mapDispatchToProps)(QueueList);
