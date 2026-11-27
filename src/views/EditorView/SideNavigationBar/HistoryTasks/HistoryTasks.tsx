import React, {useEffect, useState} from 'react';
import {Language} from '../../../../data/LanguageConfig';
import {
    AnnotatedProjectHistoryEntry,
    IndexedDBManager,
} from '../../../../utils/IndexedDBManager';
import './HistoryTasks.scss';

interface Props {
    language: Language;
}

export const HistoryTasks: React.FC<Props> = ({language}) => {
    const zh = language === Language.CHINESE;
    const [tasks, setTasks] = useState<AnnotatedProjectHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refresh, setRefresh] = useState(0);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);
        IndexedDBManager.listAnnotatedProjects().then(entries => {
            if (active) setTasks(entries);
        }).catch(cause => {
            if (active) setError(cause instanceof Error ? cause.message : String(cause));
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [refresh]);

    return <section className='HistoryTasks' aria-label={zh ? '历史任务' : 'Task History'}>
        <div className='HistoryTasks__header'>
            <strong>{zh ? '历史任务' : 'Task History'}</strong>
            <button type='button' onClick={() => setRefresh(value => value + 1)}
                aria-label={zh ? '刷新历史任务' : 'Refresh task history'}>↻</button>
        </div>
        <p className='HistoryTasks__hint'>{zh ? '本机已保存的标注任务' : 'Annotated tasks saved in this browser'}</p>
        {loading && <p className='HistoryTasks__state' role='status'>{zh ? '正在读取历史任务…' : 'Loading tasks…'}</p>}
        {error && <p className='HistoryTasks__state HistoryTasks__error' role='alert'>{error}</p>}
        {!loading && !error && tasks.length === 0 &&
            <p className='HistoryTasks__state'>{zh ? '还没有已保存的标注任务' : 'No saved annotation tasks yet'}</p>}
        {!loading && !error && tasks.length > 0 && <div className='HistoryTasks__list'>
            {tasks.map(task => {
                const url = new URL(window.location.href);
                url.searchParams.delete('new_work');
                url.searchParams.set('restore_workspace', task.workspaceId);
                const name = task.projectName?.trim() || (zh ? '未命名任务' : 'Unnamed task');
                const time = new Date(task.lastModified).toLocaleString(zh ? 'zh-CN' : 'en-US', {
                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                });
                return <a className='HistoryTasks__item' key={task.workspaceId}
                    href={url.toString()} target='_blank' rel='noopener noreferrer'
                    title={zh ? '在新标签页恢复此任务' : 'Restore this task in a new tab'}>
                    <span className='HistoryTasks__name'>{name}</span>
                    <span className='HistoryTasks__detail'>
                        {task.labelCount}/{task.imageCount} {zh
                            ? task.isVideoProject ? '帧已标注' : '张已标注'
                            : task.isVideoProject ? 'frames annotated' : 'images annotated'}
                    </span>
                    <time className='HistoryTasks__time' dateTime={new Date(task.lastModified).toISOString()}>{time}</time>
                </a>;
            })}
        </div>}
    </section>;
};

export default HistoryTasks;
