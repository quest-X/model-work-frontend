import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {EditorViewportContent} from '../EditorViewportContent';
import {Language} from '../../../../data/LanguageConfig';
import {QueueItemStatus, QueueItemType} from '../../../../store/queue/types';

jest.mock('../../CameraPlayer/CameraPlayer', () => () => <div>camera viewport</div>);
jest.mock('../../VideoEditor/VideoEditor', () => () => <div>video viewport</div>);
jest.mock('../../Editor/Editor', () => () => <div>image viewport</div>);
jest.mock('../../EditorBottomNavigationBar/EditorBottomNavigationBar', () => () => <div>image navigation</div>);

it('preserves camera precedence, video fallback, progress and empty-state import', () => {
    const onOpen = jest.fn();
    const props: React.ComponentProps<typeof EditorViewportContent> = {
        activeQueueItem: {id: 'camera-a', name: 'Camera', type: QueueItemType.CAMERA,
            status: QueueItemStatus.PENDING, uploadedAt: 1},
        language: Language.ENGLISH, isVideoMode: true, imageData: null, totalImageCount: 0,
        size: {width: 640, height: 480}, videoProcessing: null, isDragActive: false, openFileDialog: onOpen,
    };
    const view = render(<EditorViewportContent {...props}/>);
    expect(screen.getByText('camera viewport')).toBeInTheDocument();
    expect(screen.queryByText('video viewport')).toBeNull();
    view.rerender(<EditorViewportContent {...props} activeQueueItem={null}/>);
    expect(screen.getByText('video viewport')).toBeInTheDocument();
    view.rerender(<EditorViewportContent {...props} activeQueueItem={null} isVideoMode={false}
        videoProcessing={{fileName: 'loading.mp4', phase: 'Uploading', progress: 20}}/>);
    expect(screen.getByText('loading.mp4')).toBeInTheDocument();
    view.rerender(<EditorViewportContent {...props} activeQueueItem={null} isVideoMode={false}/>);
    fireEvent.click(screen.getByAltText('empty-project'));
    expect(onOpen).toHaveBeenCalledTimes(1);
});
