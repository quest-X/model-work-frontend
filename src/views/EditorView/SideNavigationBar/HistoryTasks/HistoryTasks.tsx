import React, {useEffect, useRef, useState} from 'react';
import {Language, LanguageConfig} from '../../../../data/LanguageConfig';
import {getQueueDisplayName} from '../../../../utils/QueueDisplayNameUtil';
import {
    AnnotatedProjectHistoryEntry,
    IndexedDBManager,
} from '../../../../utils/IndexedDBManager';
import {AutoSaveService} from '../../../../services/AutoSaveService';
import {ProjectRestoreService} from '../../../../services/ProjectRestoreService';
import {ContextManager} from '../../../../logic/hotkey/ContextManager';
import {ContextType} from '../../../../data/enums/ContextType';
import './HistoryTasks.scss';

interface Props {
    language: Language;
    embedded?: boolean;
    refreshToken?: number;
}

const HistoryThumbnail: React.FC<{task: AnnotatedProjectHistoryEntry; name: string; zh: boolean}> =
    ({task, name, zh}) => {
        const [firstImageUrl, setFirstImageUrl] = useState<string>();
        useEffect(() => {
            if (task.thumbnail || !task.firstImageFileData) return undefined;
            const blob = task.firstImageFileData instanceof File
                ? task.firstImageFileData
                : new Blob([task.firstImageFileData], {type: task.firstImageFileType || 'image/jpeg'});
            const url = URL.createObjectURL(blob);
            setFirstImageUrl(url);
            return () => URL.revokeObjectURL(url);
        }, [task.thumbnail, task.firstImageFileData, task.firstImageFileType]);
        const preview = task.thumbnail || firstImageUrl;
        return <span className='HistoryTasks__thumbnail'>
            <img src={preview || (task.isVideoProject ? '/ico/pictures.png' : '/ico/camera.png')}
                alt={preview ? (zh ? `${name} 首张预览` : `${name} first image`) : ''}
                loading='lazy' decoding='async'/>
        </span>;
    };

export const HistoryTasks: React.FC<Props> = ({language, embedded = false, refreshToken = 0}) => {
    const zh = language === Language.CHINESE;
    const [tasks, setTasks] = useState<AnnotatedProjectHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refresh, setRefresh] = useState(0);
    const [openingId, setOpeningId] = useState<string | null>(null);
    const [openedId, setOpenedId] = useState<string | null>(null);
    const historyRef = useRef<HTMLElement>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        if (!openingId) return undefined;
        const editor = historyRef.current?.closest('.EditorView');
        const wasInert = editor?.hasAttribute('inert');
        editor?.setAttribute('inert', '');
        ContextManager.switchCtx(ContextType.POPUP);
        return () => {
            if (!wasInert) editor?.removeAttribute('inert');
            ContextManager.restoreCtx();
        };
    }, [openingId]);

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
    }, [refresh, refreshToken]);

    const saveCurrentTask = async () => {
        const saveStartedAt = Date.now();
        await AutoSaveService.saveCurrentState(true);
        const savedAt = await IndexedDBManager.getWorkspaceSaveTime(IndexedDBManager.getWorkspaceId());
        if (savedAt === null || savedAt < saveStartedAt) {
            throw new Error(zh ? '当前任务保存失败，请重试' : 'Could not save the current task; try again');
        }
    };

    const openTask = async (task: AnnotatedProjectHistoryEntry) => {
        if (openingId || deletingId) return;
        setOpeningId(task.workspaceId);
        setError(null);
        let suspended = false;
        try {
            await saveCurrentTask();
            AutoSaveService.suspend();
            suspended = true;
            await AutoSaveService.drain();
            const selected = await IndexedDBManager.getProjectMeta(task.workspaceId);
            if (!selected?.hasRecoverableProject) {
                throw new Error(zh ? '该历史任务已不可恢复，请刷新列表' : 'This task is no longer available; refresh the list');
            }
            const restored = await ProjectRestoreService.restoreProject(undefined, {
                replaceCurrent: true,
                beforeCommit: project => IndexedDBManager.activateWorkspace(task.workspaceId, project.lastModified),
            });
            if (!restored) throw new Error(zh ? '未找到可恢复的任务数据' : 'No recoverable task data was found');
            setOpenedId(task.workspaceId);
            const url = new URL(window.location.href);
            url.searchParams.delete('new_work');
            url.searchParams.delete('restore_workspace');
            url.searchParams.delete('auto_restore');
            window.history.replaceState(window.history.state, '', url);
        } catch (cause) {
            IndexedDBManager.cancelPendingRestore();
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            if (suspended) AutoSaveService.resume();
            setOpeningId(null);
        }
    };

    const deleteCurrentTask = async (task: AnnotatedProjectHistoryEntry) => {
        AutoSaveService.suspend();
        try {
            await AutoSaveService.drain();
            const revision = await IndexedDBManager.getWorkspaceSaveTime(task.workspaceId);
            if (revision === null || !await IndexedDBManager.deleteAnnotatedProject(
                task.workspaceId, revision, true,
            )) throw new Error(zh ? '删除当前任务失败，请重试' : 'Could not delete the current task; try again');
            const url = new URL(window.location.href);
            url.searchParams.delete('restore_workspace');
            url.searchParams.delete('auto_restore');
            url.searchParams.set('new_work', '1');
            window.history.replaceState(window.history.state, '', url);
            window.location.reload();
        } catch (cause) {
            AutoSaveService.resume();
            throw cause;
        }
    };

    const deleteTask = async (task: AnnotatedProjectHistoryEntry, name: string) => {
        if (openingId || deletingId) return;
        const isCurrent = task.workspaceId === IndexedDBManager.getWorkspaceId();
        if (!window.confirm(zh
            ? isCurrent ? `确定删除当前任务“${name}”并清空编辑区？此操作无法撤销。` :
                `确定删除历史任务“${name}”？此操作无法撤销。`
            : isCurrent ? `Delete the current task “${name}” and clear the editor? This cannot be undone.` :
                `Delete task “${name}”? This cannot be undone.`)) return;
        setDeletingId(task.workspaceId);
        setError(null);
        try {
            if (isCurrent) {
                await deleteCurrentTask(task);
                return;
            }
            await saveCurrentTask();
            if (!await IndexedDBManager.deleteAnnotatedProject(task.workspaceId, task.lastModified)) {
                throw new Error(zh ? '删除失败，任务可能已更新；请刷新列表重试' :
                    'Could not delete this task; refresh the list and try again');
            }
            setRefresh(value => value + 1);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setDeletingId(null);
        }
    };

    return <section ref={historyRef} className='HistoryTasks' aria-label={zh ? '历史任务' : 'Task History'}>
        {!embedded && <div className='HistoryTasks__header'>
            <strong>{zh ? '历史任务' : 'Task History'}</strong>
            <button type='button' onClick={() => setRefresh(value => value + 1)}
                aria-label={zh ? '刷新历史任务' : 'Refresh task history'}>↻</button>
        </div>}
        {loading && <p className='HistoryTasks__state' role='status'>{zh ? '正在读取历史任务…' : 'Loading tasks…'}</p>}
        {error && <p className='HistoryTasks__state HistoryTasks__error' role='alert'>{error}</p>}
        {!loading && !error && tasks.length === 0 &&
            <p className='HistoryTasks__state'>{zh ? '还没有已保存的标注任务' : 'No saved annotation tasks yet'}</p>}
        {!loading && tasks.length > 0 && <div className='HistoryTasks__list'>
            {tasks.map(task => {
                const name = task.projectName?.trim() || (zh ? '未命名任务' : 'Unnamed task');
                const displayName = task.queueDisplay
                    ? getQueueDisplayName(task.queueDisplay, LanguageConfig[language]) : name;
                const time = new Date(task.lastModified).toLocaleString(zh ? 'zh-CN' : 'en-US', {
                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                });
                return <div className='HistoryTasks__row' key={task.workspaceId}>
                    <button className={`HistoryTasks__item${openedId === task.workspaceId ? ' is-active' : ''}`} type='button'
                        aria-pressed={openedId === task.workspaceId}
                        aria-busy={openingId === task.workspaceId}
                        disabled={openingId !== null || deletingId !== null}
                        onClick={() => void openTask(task)}
                        title={zh ? '在当前页面打开此任务' : 'Open this task here'}>
                        <HistoryThumbnail task={task} name={displayName} zh={zh}/>
                        <span className='HistoryTasks__copy'>
                            <span className='HistoryTasks__name'>{displayName}</span>
                            <span className='HistoryTasks__detail'>
                                {task.labelCount}/{task.imageCount} {zh
                                    ? task.isVideoProject ? '帧已标注' : '张已标注'
                                    : task.isVideoProject ? 'frames annotated' : 'images annotated'}
                            </span>
                            <time className='HistoryTasks__time' dateTime={new Date(task.lastModified).toISOString()}>{time}</time>
                        </span>
                    </button>
                    <button className='HistoryTasks__delete' type='button'
                        disabled={openingId !== null || deletingId !== null}
                        onClick={() => void deleteTask(task, name)}
                        title={zh ? `删除历史任务 ${name}` : `Delete task ${name}`}
                        aria-label={zh ? `删除历史任务 ${name}` : `Delete task ${name}`}>×</button>
                </div>;
            })}
        </div>}
    </section>;
};

export default HistoryTasks;
