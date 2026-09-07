import React, {useEffect, useState} from 'react';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {ManagedTask} from '../../../store/tasks/types';
import {getEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import '../DataCenterPopup/DataCenterPopup.scss';
import './TaskCenterPopup.scss';

interface CoreJob {
    job_id: string;
    state: string;
    name?: string;
    dataset_id?: string;
    model?: string;
    started_at?: string;
    total_images?: number;
    processed_images?: number;
    progress?: {epoch?: number; total_epochs?: number};
}

interface DisplayTask {
    id: string;
    phase: 'planned' | 'running';
    type: string;
    title: string;
    detail?: string;
    progress?: number;
    startedAt: number;
}

interface IProps {
    language: Language;
    tasks: ManagedTask[];
}

const POLL_INTERVAL_MS = 3000;
const RUNNING_STATES = new Set(['running', 'cancelling', 'saving']);

const readJobs = async (url: string): Promise<CoreJob[]> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.jobs)) throw new Error('Invalid jobs response');
    return data.jobs;
};

const progressPercent = (done?: number, total?: number): number | undefined =>
    total && total > 0 ? Math.min(100, Math.round(((done ?? 0) / total) * 100)) : undefined;

export const TaskCenterPopupComponent: React.FC<IProps> = ({language, tasks}) => {
    const zh = language === Language.CHINESE;
    const baseUrl = getEngineBaseUrl();
    const [remoteTasks, setRemoteTasks] = useState<DisplayTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [queryError, setQueryError] = useState(false);
    const [activePhase, setActivePhase] = useState<DisplayTask['phase']>('running');
    const copy = zh ? {
        navTitle: '任务状态',
        hint: '汇总推理系统、训练系统及当前操作中的任务。',
        warning: '部分任务来源暂时不可用，已显示其余任务。',
        running: {
            label: '正在运行',
            detail: '执行中的任务',
            description: '查看当前正在执行的任务及进度。',
            empty: '暂无正在运行任务',
        },
        planned: {
            label: '计划任务',
            detail: '等待执行的任务',
            description: '查看等待执行的任务。',
            empty: '暂无计划任务',
        },
    } : {
        navTitle: 'Task status',
        hint: 'Tasks from inference, training, and current operations.',
        warning: 'Some task sources are unavailable; other tasks are shown.',
        running: {
            label: 'Running',
            detail: 'Tasks in progress',
            description: 'View tasks in progress.',
            empty: 'No running tasks',
        },
        planned: {
            label: 'Planned',
            detail: 'Waiting to start',
            description: 'View tasks waiting to start.',
            empty: 'No planned tasks',
        },
    };

    useEffect(() => {
        let active = true;
        const refresh = async () => {
            const [inference, training] = await Promise.allSettled([
                readJobs(`${baseUrl}/dataset-inference/jobs`),
                readJobs(`${baseUrl}/training/jobs`),
            ]);
            if (!active) return;
            const mapped: DisplayTask[] = [];
            if (inference.status === 'fulfilled') inference.value.forEach(job => {
                if (job.state !== 'queued' && !RUNNING_STATES.has(job.state)) return;
                mapped.push({
                    id: `inference:${job.job_id}`,
                    phase: job.state === 'queued' ? 'planned' : 'running',
                    type: zh ? '推理' : 'Inference',
                    title: job.name || `${zh ? '自动推理' : 'Auto inference'} ${job.job_id.slice(0, 8)}`,
                    detail: [job.dataset_id, job.model].filter(Boolean).join(' · '),
                    progress: progressPercent(job.processed_images, job.total_images),
                    startedAt: job.started_at ? Date.parse(job.started_at) : 0,
                });
            });
            if (training.status === 'fulfilled') training.value.forEach(job => {
                if (job.state !== 'queued' && job.state !== 'running') return;
                mapped.push({
                    id: `training:${job.job_id}`,
                    phase: job.state === 'queued' ? 'planned' : 'running',
                    type: zh ? '训练' : 'Training',
                    title: job.name || `${zh ? '训练任务' : 'Training'} ${job.job_id.slice(0, 8)}`,
                    detail: job.dataset_id,
                    progress: progressPercent(job.progress?.epoch, job.progress?.total_epochs),
                    startedAt: job.started_at ? Date.parse(job.started_at) : 0,
                });
            });
            setRemoteTasks(mapped);
            setQueryError(inference.status === 'rejected' || training.status === 'rejected');
            setLoading(false);
        };
        void refresh();
        const timer = window.setInterval(refresh, POLL_INTERVAL_MS);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [baseUrl, zh]);

    const localTasks: DisplayTask[] = tasks.filter(task => task.status === 'running').map(task => ({
        id: `local:${task.id}`,
        phase: 'running',
        type: zh ? '当前操作' : 'Current operation',
        title: task.title,
        detail: task.subtitle,
        progress: task.progress,
        startedAt: task.startedAt,
    }));
    const allTasks = [...remoteTasks, ...localTasks].sort((left, right) => right.startedAt - left.startedAt);
    const planned = allTasks.filter(task => task.phase === 'planned');
    const running = allTasks.filter(task => task.phase === 'running');
    const visibleTasks = activePhase === 'running' ? running : planned;
    const activeCopy = copy[activePhase];

    const renderList = (items: DisplayTask[], empty: string) => items.length === 0
        ? <div className='TaskCenterEmpty'>{loading ? (zh ? '正在读取…' : 'Loading…') : empty}</div>
        : items.map(task => <article className='DatasetItem TaskCenterRow' key={task.id}>
            <div className='TaskCenterRowHeader'>
                <strong>{task.title}</strong>
                <span>{task.type}</span>
            </div>
            {task.detail && <div className='TaskCenterDetail'>{task.detail}</div>}
            {task.progress !== undefined && <div className='TaskCenterProgress' aria-label={`${task.progress}%`}>
                <div style={{width: `${task.progress}%`}}/>
                <small>{task.progress}%</small>
            </div>}
        </article>);

    const renderContent = () => <div className='DataCenterPopupContent TaskCenterPopupContent'>
        <div className='DataWorkspace'>
            <aside className='DataTierSidebar'>
                <div className='DataTierNavTitle'>{copy.navTitle}</div>
                <div
                    className='DataTierTabs'
                    role='tablist'
                    aria-label={copy.navTitle}
                    aria-orientation='vertical'
                >
                    <button
                        id='task-phase-running'
                        type='button'
                        role='tab'
                        aria-label={copy.running.label + ' ' + running.length}
                        aria-controls='task-center-panel'
                        aria-selected={activePhase === 'running'}
                        tabIndex={activePhase === 'running' ? 0 : -1}
                        className={activePhase === 'running' ? 'active persistent' : ''}
                        onClick={() => setActivePhase('running')}
                    >
                        <span className='DataTierTabCopy'>
                            <span>{copy.running.label}</span>
                            <small>{copy.running.detail}</small>
                        </span>
                        <strong>{running.length}</strong>
                    </button>
                    <button
                        id='task-phase-planned'
                        type='button'
                        role='tab'
                        aria-label={copy.planned.label + ' ' + planned.length}
                        aria-controls='task-center-panel'
                        aria-selected={activePhase === 'planned'}
                        tabIndex={activePhase === 'planned' ? 0 : -1}
                        className={activePhase === 'planned' ? 'active temporary' : ''}
                        onClick={() => setActivePhase('planned')}
                    >
                        <span className='DataTierTabCopy'>
                            <span>{copy.planned.label}</span>
                            <small>{copy.planned.detail}</small>
                        </span>
                        <strong>{planned.length}</strong>
                    </button>
                </div>
                <p className='DataTierSidebarHint'>{copy.hint}</p>
            </aside>
            <div
                id='task-center-panel'
                className='DataTierMain'
                role='tabpanel'
                aria-labelledby={activePhase === 'running' ? 'task-phase-running' : 'task-phase-planned'}
            >
                <section className='DataTierPanel'>
                    <div className={activePhase === 'running'
                        ? 'TierExplanation persistent'
                        : 'TierExplanation'}
                    >
                        <div>
                            <strong>{activeCopy.label}</strong>
                            <span>{activeCopy.description}</span>
                        </div>
                    </div>
                    {queryError && <p role='alert' className='TaskCenterWarning'>{copy.warning}</p>}
                    <div className='DatasetList TaskCenterList'>{renderList(
                        visibleTasks,
                        activeCopy.empty,
                    )}</div>
                </section>
            </div>
        </div>
    </div>;

    return <GenericYesNoPopup
        title={zh ? '任务中心' : 'Task Center'}
        renderContent={renderContent}
        skipAcceptButton
        rejectLabel={zh ? '关闭' : 'Close'}
        onReject={() => PopupActions.close()}
    />;
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
    tasks: state.tasks.tasks,
});

export default connect(mapStateToProps)(TaskCenterPopupComponent);
