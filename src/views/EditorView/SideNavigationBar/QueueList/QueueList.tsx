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
import './QueueList.scss';

// ============ QueueItemCard ============

interface CardProps {
    item: QueueItem;
    isActive: boolean;
    onSelect: (item: QueueItem) => void;
    onDelete: (itemId: string) => void;
}

const typeIconMap: Record<QueueItemType, string> = {
    [QueueItemType.VIDEO]: '/ico/pictures.png',
    [QueueItemType.IMAGE]: '/ico/camera.png',
    [QueueItemType.FOLDER]: '/ico/files.png',
};

const statusConfig: Record<QueueItemStatus, { className: string; label: string }> = {
    [QueueItemStatus.PENDING]:    { className: 'status-pending',    label: '待处理' },
    [QueueItemStatus.PROCESSING]: { className: 'status-processing', label: '加载中' },
    [QueueItemStatus.COMPLETED]:  { className: 'status-completed',  label: '已完成' },
    [QueueItemStatus.ERROR]:      { className: 'status-error',      label: '错误' },
};

const QueueItemCard: React.FC<CardProps> = ({ item, isActive, onSelect, onDelete }) => {
    const statusInfo = statusConfig[item.status];

    return (
        <div
            className={classNames('queue-item-card', { 'active': isActive })}
            onClick={() => onSelect(item)}
            title={item.error || item.name}
        >
            <div className='card-thumbnail'>
                {item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.name} draggable={false} />
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
                <span className='card-name'>{item.name}</span>
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
                title='删除'
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
    removeQueueItemAction: (itemId: string) => any;
    updateImageDataAction: (imageData: ImageData[]) => any;
}

const QueueList: React.FC<IProps> = ({
    items,
    activeQueueItemId,
    imagesData,
    removeQueueItemAction,
    updateImageDataAction,
}) => {
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
                    <p>队列为空</p>
                    <p className='queue-list-empty-hint'>拖拽文件到编辑区域以添加</p>
                </div>
            ) : (
                <div className='queue-list-scroll'>
                    {items.map(item => (
                        <QueueItemCard
                            key={item.id}
                            item={item}
                            isActive={item.id === activeQueueItemId}
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
});

const mapDispatchToProps = {
    removeQueueItemAction: removeQueueItem,
    updateImageDataAction: updateImageData,
};

export default connect(mapStateToProps, mapDispatchToProps)(QueueList);
