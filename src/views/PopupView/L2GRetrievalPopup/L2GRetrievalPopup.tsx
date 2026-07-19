import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useDropzone} from 'react-dropzone';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {getExtensionEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import './L2GRetrievalPopup.scss';

interface PipelineStatus {
    state: string;           // not_loaded | loading | ready | missing_dep | error
    error: string | null;
}

interface L2GStatus {
    status: string;
    version: string;
    pipeline: PipelineStatus;
    config_file: string;
    defaults: {top_k: number; max_database_size: number};
}

interface L2GResult {
    path: string;
    score: number;
    thumbnail: string | null;
}

interface IProps {
    language: Language;
}

const EP = '/l2g_retrieval';

const L2GRetrievalPopup: React.FC<IProps> = ({language}) => {
    const zh = language === Language.CHINESE;
    const t = useCallback(
        (zhText: string, enText: string) => (zh ? zhText : enText),
        [zh],
    );
    const baseUrl = getExtensionEngineBaseUrl();

    const [status, setStatus] = useState<L2GStatus | null>(null);
    const [backendDown, setBackendDown] = useState(false);
    const [queryFile, setQueryFile] = useState<File | null>(null);
    const [queryPreview, setQueryPreview] = useState<string | null>(null);
    const [databaseDir, setDatabaseDir] = useState('');
    const [topK, setTopK] = useState(10);
    const [searching, setSearching] = useState(false);
    const [elapsed, setElapsed] = useState<number | null>(null);
    const [results, setResults] = useState<L2GResult[]>([]);
    const [searchError, setSearchError] = useState<string | null>(null);
    const searchingRef = useRef(false);

    const fetchStatus = useCallback(async () => {
        try {
            const resp = await fetch(`${baseUrl}${EP}/status`);
            if (!resp.ok) throw new Error(String(resp.status));
            setStatus(await resp.json());
            setBackendDown(false);
        } catch {
            setBackendDown(true);
        }
    }, [baseUrl]);

    useEffect(() => {
        fetchStatus();
        const timer = window.setInterval(fetchStatus, 5000);
        return () => window.clearInterval(timer);
    }, [fetchStatus]);

    const doWarmup = async () => {
        try {
            await fetch(`${baseUrl}${EP}/warmup`, {method: 'POST'});
        } catch { /* status 轮询会反映结果 */ }
        fetchStatus();
    };

    const onDrop = useCallback((accepted: File[]) => {
        if (accepted.length === 0) return;
        const file = accepted[0];
        setQueryFile(file);
        setQueryPreview(URL.createObjectURL(file));
        setResults([]);
        setSearchError(null);
    }, []);

    const {getRootProps, getInputProps, isDragActive} = useDropzone({
        onDrop,
        accept: {'image/*': ['.jpg', '.jpeg', '.png']},
        multiple: false,
    });

    const doSearch = async () => {
        if (!queryFile || !databaseDir.trim() || searchingRef.current) return;
        searchingRef.current = true;
        setSearching(true);
        setSearchError(null);
        setResults([]);
        setElapsed(null);
        try {
            const form = new FormData();
            form.append('query', queryFile);
            form.append('database_dir', databaseDir.trim());
            form.append('top_k', String(topK));
            const resp = await fetch(`${baseUrl}${EP}/search`, {method: 'POST', body: form});
            const data = await resp.json();
            if (!resp.ok) {
                setSearchError(String(data.detail ?? resp.status));
            } else {
                setResults(data.results ?? []);
                setElapsed(data.elapsed_s ?? null);
            }
        } catch (e) {
            setSearchError(String(e));
        } finally {
            searchingRef.current = false;
            setSearching(false);
        }
    };

    const pipelineState = status?.pipeline?.state ?? 'unknown';
    const ready = pipelineState === 'ready';

    const renderBanner = () => {
        if (backendDown) {
            return <div className='Banner error'>{t('推理后端不可达，或 L2G 插件未启用', 'Backend unreachable or L2G plugin disabled')}</div>;
        }
        if (pipelineState === 'error' || pipelineState === 'missing_dep') {
            return (
                <div className='Banner error'>
                    {t('管道异常：', 'Pipeline error: ')}{status?.pipeline?.error ?? pipelineState}
                </div>
            );
        }
        if (pipelineState === 'loading') {
            return <div className='Banner info'>{t('管道加载中…（首次含权重加载）', 'Pipeline loading… (first run loads weights)')}</div>;
        }
        if (!ready) {
            return (
                <div className='Banner info'>
                    {t('管道未加载。', 'Pipeline not loaded. ')}
                    <button className='InlineButton' onClick={doWarmup}>{t('立即加载（Warmup）', 'Warm up now')}</button>
                </div>
            );
        }
        return <div className='Banner ok'>{t('管道就绪', 'Pipeline ready')} · v{status?.version}</div>;
    };

    const renderContent = () => (
        <div className='L2GRetrievalPopupContent'>
            {renderBanner()}
            <div className='Hint'>
                {t('L2G 局部到全局高精度检索：FIRe 局部特征 + ASMK 聚合 + 全局重排。秒~分钟级，适合高精度场景；毫秒级交互检索请用「向量数据库」。',
                   'L2G local-to-global high-precision retrieval: FIRe local features + ASMK aggregation + global re-ranking. Seconds to minutes per query; for millisecond interactive search use Vector Database.')}
            </div>
            <div className='SearchForm'>
                <div className='QueryPanel'>
                    <div {...getRootProps({className: `QueryDropzone${isDragActive ? ' active' : ''}`})}>
                        <input {...getInputProps()} />
                        {queryPreview
                            ? <img className='QueryPreview' src={queryPreview} alt='query'/>
                            : <span>{t('拖入或点击选择查询图', 'Drop or click to pick a query image')}</span>}
                    </div>
                    {queryFile && <div className='QueryFileName' title={queryFile.name}>{queryFile.name}</div>}
                </div>
                <div className='Fields'>
                    <label>
                        {t('服务器图库目录', 'Server database dir')}
                        <input
                            type='text'
                            value={databaseDir}
                            placeholder={t('推理后端上的图片目录绝对路径', 'Absolute image dir path on the backend host')}
                            onChange={e => setDatabaseDir(e.target.value)}
                        />
                    </label>
                    <label>
                        Top-K
                        <input
                            type='number'
                            min={1}
                            max={100}
                            value={topK}
                            onChange={e => setTopK(Number(e.target.value) || 10)}
                        />
                    </label>
                    <button
                        className='SearchButton'
                        disabled={!ready || !queryFile || !databaseDir.trim() || searching}
                        onClick={doSearch}
                    >
                        {searching ? t('检索中…', 'Searching…') : t('检索', 'Search')}
                    </button>
                </div>
            </div>
            {searchError && <div className='Banner error'>{searchError}</div>}
            {elapsed !== null && (
                <div className='ResultSummary'>
                    {t('耗时', 'Elapsed')} {elapsed}s · {results.length} {t('个结果', 'results')}
                </div>
            )}
            {elapsed !== null && results.length === 0 && (
                <div className='EmptyHint'>{t('无相似结果', 'No similar results')}</div>
            )}
            {results.length > 0 && (
                <div className='ResultGrid'>
                    {results.map((r, i) => (
                        <div className='ResultCard' key={r.path}>
                            {r.thumbnail
                                ? <img src={r.thumbnail} alt={r.path}/>
                                : <div className='ThumbPlaceholder'>{t('源图缺失', 'missing')}</div>}
                            <div className='RankBadge'>{i + 1}</div>
                            <div className='ScoreBadge'>{(r.score * 100).toFixed(1)}%</div>
                            <div className='ResultMeta'>
                                <span className='FileName' title={r.path}>{r.path}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <GenericYesNoPopup
            title={t('高精度检索（L2G）', 'L2G Retrieval')}
            renderContent={renderContent}
            skipAcceptButton
            rejectLabel={t('关闭', 'Close')}
            onReject={() => PopupActions.close()}
        />
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
});

export default connect(mapStateToProps)(L2GRetrievalPopup);
