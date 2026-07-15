import React, {useEffect, useState} from 'react';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {getEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import './TrainingTaskPopup.scss';

interface DatasetSummary {
    id: string;
    name: string;
    image_count: number;
    classes: string[];
}

interface TrainingJobProgress {
    epoch: number;
    total_epochs: number;
    metrics: Record<string, number>;
}

interface TrainingJobStatus {
    job_id: string;
    state: string;
    name?: string;
    dataset_id?: string;
    error?: string;
    progress: TrainingJobProgress;
    produced_model?: string;
}

interface IProps {
    language: Language;
}

const POLL_INTERVAL_MS = 3000;

const TrainingTaskPopup: React.FC<IProps> = ({language}) => {
    const zh = language === Language.CHINESE;
    const baseUrl = getEngineBaseUrl();

    const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
    const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
    const [epochs, setEpochs] = useState(100);
    const [imgsz, setImgsz] = useState(640);
    const [batch, setBatch] = useState(16);
    const [jobs, setJobs] = useState<TrainingJobStatus[]>([]);
    const [createError, setCreateError] = useState<string | null>(null);

    useEffect(() => {
        fetch(`${baseUrl}/datasets`).then(r => r.json()).then(data => {
            if (Array.isArray(data.datasets)) {
                setDatasets(data.datasets);
                if (data.datasets.length > 0) setSelectedDatasetId((prev) => prev || data.datasets[0].id);
            }
        }).catch(() => undefined);
    }, [baseUrl]);

    const refreshJobs = () => {
        fetch(`${baseUrl}/training/jobs`).then(r => r.json()).then(data => {
            if (Array.isArray(data.jobs)) setJobs(data.jobs);
        }).catch(() => undefined);
    };

    useEffect(() => {
        refreshJobs();
        const timer = setInterval(refreshJobs, POLL_INTERVAL_MS);
        return () => clearInterval(timer);
        // eslint-disable-next-line
    }, [baseUrl]);

    const startTraining = () => {
        if (!selectedDatasetId) return;
        setCreateError(null);
        fetch(`${baseUrl}/training/jobs`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                dataset_id: selectedDatasetId,
                model_type: 'yolov8n-seg',
                epochs,
                imgsz,
                batch,
            }),
        }).then(async (r) => {
            if (!r.ok) {
                const body = await r.json().catch(() => ({}));
                throw new Error(body.detail || `${r.status}`);
            }
            refreshJobs();
        }).catch((e) => setCreateError(e.message));
    };

    const cancelJob = (jobId: string) => {
        fetch(`${baseUrl}/training/jobs/${jobId}/cancel`, {method: 'POST'}).then(refreshJobs).catch(() => undefined);
    };

    const loadIntoInference = (job: TrainingJobStatus) => {
        if (!job.produced_model) return;
        const service = 'detection';
        fetch(`${baseUrl}/load-model`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({model: job.produced_model, service}),
        }).then(() => {
            window.dispatchEvent(new CustomEvent('opensight:model-loaded'));
        }).catch(() => undefined);
    };

    const stateLabel = (state: string): string => {
        const map: Record<string, [string, string]> = {
            queued: ['排队中', 'Queued'],
            running: ['训练中', 'Running'],
            completed: ['已完成', 'Completed'],
            failed: ['失败', 'Failed'],
            cancelled: ['已取消', 'Cancelled'],
        };
        const pair = map[state];
        return pair ? (zh ? pair[0] : pair[1]) : state;
    };

    const renderContent = () => (
        <div className='TrainingTaskPopupContent'>
            <div className='FormSection'>
                <div className='SectionHeader'>{zh ? '新建训练任务' : 'New Training Job'}</div>
                <div className='FormRow'>
                    <label>{zh ? '数据集' : 'Dataset'}</label>
                    <select value={selectedDatasetId} onChange={(e) => setSelectedDatasetId(e.target.value)}>
                        {datasets.length === 0 && <option value=''>{zh ? '暂无数据集' : 'No datasets'}</option>}
                        {datasets.map(ds => (
                            <option key={ds.id} value={ds.id}>{ds.name} ({ds.image_count})</option>
                        ))}
                    </select>
                </div>
                <div className='FormRow'>
                    <label>Epochs</label>
                    <input type='number' value={epochs} min={1} onChange={(e) => setEpochs(Number(e.target.value))} />
                </div>
                <div className='FormRow'>
                    <label>Imgsz</label>
                    <input type='number' value={imgsz} min={32} step={32} onChange={(e) => setImgsz(Number(e.target.value))} />
                </div>
                <div className='FormRow'>
                    <label>Batch</label>
                    <input type='number' value={batch} min={1} onChange={(e) => setBatch(Number(e.target.value))} />
                </div>
                {createError && <p className='errorMessage'>{createError}</p>}
                <button className='StartButton' disabled={!selectedDatasetId} onClick={startTraining}>
                    {zh ? '开始训练' : 'Start Training'}
                </button>
            </div>
            <div className='JobListSection'>
                <div className='SectionHeader'>{zh ? '训练任务' : 'Jobs'}</div>
                {jobs.length === 0 && <div className='EmptyHint'>{zh ? '暂无训练任务' : 'No jobs yet'}</div>}
                {jobs.map(job => {
                    const pct = job.progress.total_epochs > 0
                        ? Math.round((job.progress.epoch / job.progress.total_epochs) * 100)
                        : 0;
                    return (
                        <div className='JobRow' key={job.job_id}>
                            <div className='JobRowHeader'>
                                <span className='JobName'>{job.name || job.job_id}</span>
                                <span className={`JobState state-${job.state}`}>{stateLabel(job.state)}</span>
                            </div>
                            {job.state === 'running' && (
                                <div className='ProgressBar'>
                                    <div className='ProgressBarFill' style={{width: `${pct}%`}} />
                                </div>
                            )}
                            {job.state === 'running' && (
                                <span className='JobEpoch'>{job.progress.epoch}/{job.progress.total_epochs}</span>
                            )}
                            {job.error && <p className='errorMessage'>{job.error}</p>}
                            <div className='JobActions'>
                                {(job.state === 'queued' || job.state === 'running') && (
                                    <button onClick={() => cancelJob(job.job_id)}>{zh ? '取消' : 'Cancel'}</button>
                                )}
                                {job.state === 'completed' && job.produced_model && (
                                    <button onClick={() => loadIntoInference(job)}>{zh ? '加载到推理任务' : 'Load into Inference'}</button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    return (
        <GenericYesNoPopup
            title={zh ? '训练任务' : 'Training Task'}
            renderContent={renderContent}
            skipAcceptButton
            rejectLabel={zh ? '关闭' : 'Close'}
            onReject={() => PopupActions.close()}
        />
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
});

export default connect(mapStateToProps)(TrainingTaskPopup);
