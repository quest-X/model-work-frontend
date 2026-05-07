import React from 'react';
import {ManagedTask, TaskStatus} from '../../../store/tasks/types';
import {LanguageTexts} from '../../../data/LanguageConfig';
import {TaskTracker} from '../../../services/TaskTracker';

interface IProps {
    task: ManagedTask;
    texts: LanguageTexts['taskManager'];
}

const STATUS_COLOR: Record<TaskStatus, string> = {
    running: '#009efd',
    completed: '#009944',
    error: '#d42245',
    cancelled: '#888',
};

export const TaskRow: React.FC<IProps> = ({task, texts}) => {
    const statusLabel = (() => {
        switch (task.status) {
            case 'running': return texts.statusRunning;
            case 'completed': return texts.statusCompleted;
            case 'error': return texts.statusError;
            case 'cancelled': return texts.statusCancelled;
        }
    })();

    const showCancel = task.status === 'running' && task.cancellable;

    return (
        <div className='TaskRow'>
            <div className='TaskRow__head'>
                <div className='TaskRow__title'>{task.title}</div>
                <div className='TaskRow__right'>
                    <span
                        className='TaskRow__status'
                        style={{backgroundColor: STATUS_COLOR[task.status]}}
                    >
                        {statusLabel}
                    </span>
                    {showCancel && (
                        <button
                            className='TaskRow__cancel'
                            onClick={() => TaskTracker.cancelById(task.id)}
                            title={texts.cancel}
                            type='button'
                        >
                            ×
                        </button>
                    )}
                </div>
            </div>
            {task.subtitle && <div className='TaskRow__subtitle'>{task.subtitle}</div>}
            {task.errorMessage && <div className='TaskRow__error'>{task.errorMessage}</div>}
            <div className='TaskRow__progress'>
                {task.progress === undefined && task.status === 'running' ? (
                    <div className='TaskRow__progress--indeterminate'/>
                ) : (
                    <div
                        className='TaskRow__progress--bar'
                        style={{
                            width: `${Math.min(100, Math.max(0, task.progress ?? 0))}%`,
                            backgroundColor: STATUS_COLOR[task.status],
                        }}
                    />
                )}
            </div>
        </div>
    );
};
