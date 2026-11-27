import React, {useEffect, useState} from 'react';
import {getSigineSelection, SIGINE_SELECTION_CHANGED, SigineSelection, updateSigineSelection} from '../../utils/SigineInfra';

type Source = {id: string; label: string; scope: 'online' | 'offline';
    models: Array<{id: string; available: boolean}>};
type Props = {baseUrl: string; zh: boolean; onChange?: (model: string, selection?: SigineSelection) => void;
    onCountChange?: (count: number | null) => void};

function initialSelection(sources: Source[], model: string): SigineSelection | undefined {
    const saved = getSigineSelection();
    if (saved) return saved;
    const preferred = sources.find(item => item.models.some(entry => entry.id === model && entry.available));
    const source = preferred || sources.find(item => item.models.some(entry => entry.available));
    const selected = source?.models.find(item => item.available && (!preferred || item.id === model));
    return selected ? {source_id: source.id, model: selected.id} : undefined;
}


async function loadDirectory(baseUrl: string) {
    const response = await fetch(`${baseUrl}/sigine-infra/catalog`);
    if (!response.ok && response.status !== 404) throw new Error('catalog');
    const catalog = response.ok ? await response.json() : null;
    if (Array.isArray(catalog?.sources) && catalog.sources.length) return catalog;
    const status = await fetch(`${baseUrl}/sigine-infra/status`);
    return status.ok ? await status.json() : {};
}

function modelAvailable(sources: Source[], selection?: SigineSelection): boolean {
    return sources.find(item => item.id === selection?.source_id)?.models.some(model => model.id === selection?.model && model.available) === true;
}

function choiceAvailable(loading: boolean, failed: boolean, legacyModel: string, sources: Source[], selection?: SigineSelection) {
    return !loading && !failed && (modelAvailable(sources, selection) || !!legacyModel);
}

export default function SigineInfraChoice({baseUrl, zh, onChange, onCountChange}: Props) {
    const [sources, setSources] = useState<Source[]>([]);
    const [selection, setSelection] = useState<SigineSelection | undefined>(getSigineSelection);
    const [enabled, setEnabled] = useState(() => localStorage.getItem('opensight.sigineInfra') === 'true');
    const [legacyModel, setLegacyModel] = useState('');
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [modelCount, setModelCount] = useState<number | null>(null);
    const available = choiceAvailable(loading, failed, legacyModel, sources, selection);

    useEffect(() => {onCountChange?.(modelCount);}, [modelCount, onCountChange]);

    useEffect(() => {
        const sync = () => {
            setSelection(getSigineSelection());
            setEnabled(localStorage.getItem('opensight.sigineInfra') === 'true');
        };
        window.addEventListener(SIGINE_SELECTION_CHANGED, sync);
        return () => window.removeEventListener(SIGINE_SELECTION_CHANGED, sync);
    }, []);

    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                const catalog = await loadDirectory(baseUrl);
                if (!active) return;
                if (Array.isArray(catalog?.sources) && catalog.sources.length) {
                    setSources(catalog.sources);
                    setModelCount(catalog.sources.reduce((total: number, source: Source) => total + source.models.length, 0));
                    const next = initialSelection(catalog.sources, catalog.model);
                    if (next) {
                        setSelection(next);
                        localStorage.setItem('opensight.sigineInfraSelection', JSON.stringify(next));
                    }
                } else {
                    setModelCount(catalog.available ? 1 : 0);
                    if (catalog.available && !getSigineSelection()) setLegacyModel(catalog.model || 'Sigine');
                }
            } catch {
                if (active) setFailed(true);
            } finally {
                if (active) setLoading(false);
            }
        };
        void load();
        return () => {active = false;};
    }, [baseUrl]);

    useEffect(() => {
        if (loading) return;
        onChange?.(enabled && available ? (selection?.model || legacyModel) : '', selection);
        if (!loading && !available) {
            setEnabled(false);
            localStorage.removeItem('opensight.sigineInfra');
        }
    }, [enabled, available, loading, selection, legacyModel, onChange]);

    const toggle = (next?: SigineSelection) => {
        const checked = enabled && (!next || (next.source_id === selection?.source_id && next.model === selection?.model));
        updateSigineSelection(!checked, next);
    };

    return <details>
        <summary>{zh ? 'Sigine INFRA 推理引擎' : 'Sigine INFRA Inference Engine'}</summary>
        {(['online', 'offline'] as const).map(scope => {
            const group = sources.filter(source => source.scope === scope);
            return <details key={scope}>
                <summary>{scope === 'online' ? (zh ? '在线' : 'Online') : (zh ? '局域网' : 'LAN')}</summary>
                {!group.length && <div className='InferenceMenuStatus'>{zh ? '暂无来源' : 'No sources'}</div>}
                {group.map(source => <details key={source.id}>
                    <summary>{source.label}</summary>
                    {source.models.map(model => <label key={model.id} className="InferenceMenuRow">
                        <input type='checkbox' disabled={!model.available}
                            data-source-id={source.id} data-model-id={model.id}
                            data-model-option='sigine'
                            checked={enabled && selection?.source_id === source.id && selection?.model === model.id}
                            onChange={() => toggle({source_id: source.id, model: model.id})}/>
                        {model.id}
                    </label>)}
                </details>)}
            </details>;
        })}
        {legacyModel && <label className="InferenceMenuRow"><input type='checkbox' checked={enabled && available}
            disabled={!available} onChange={() => toggle()}/>{legacyModel}</label>}
        {loading && <div className='InferenceMenuStatus' role='status'>{zh ? '读取 Sigine 模型目录…' : 'Loading Sigine catalog…'}</div>}
        {!loading && !available && <div className='InferenceMenuStatus' role='status'>{failed ? (zh ? '模型目录读取失败，请重新打开重试' : 'Catalog failed; reopen to retry') : (zh ? '未连接或未选择可用模型' : 'Unavailable; select a model')}</div>}
    </details>;
}
