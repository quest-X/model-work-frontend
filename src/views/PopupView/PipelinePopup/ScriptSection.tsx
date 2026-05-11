import React, {useEffect, useState, useCallback, useRef} from 'react';
import {ScriptStore, ScriptInfo, fetchScripts, uploadScript, deleteScript} from '../../../ai/ScriptStore';

interface IProps {
    /** 'preprocess' or 'postprocess' — 决定列表里只显示带哪个 hook 的脚本 */
    stage: 'preprocess' | 'postprocess';
    zh: boolean;
}

/**
 * 折叠区：[ 自定义脚本 ]
 * - 列出已上传脚本（按 stage 过滤——只显示带对应 hook 的）
 * - 单选当前激活脚本（None 表示不启用）
 * - 上传 / 删除按钮
 * - JSON params 文本框（与 stage 共享同一个，存在 ScriptStore 里）
 *
 * 不带"保存"按钮——选择即时写入 ScriptStore，由 popup 整体 onAccept 不需要再处理这部分。
 */
export const ScriptSection: React.FC<IProps> = ({stage, zh}) => {
    const [collapsed, setCollapsed] = useState(true);
    const [scripts, setScripts] = useState<ScriptInfo[]>([]);
    const [error, setError] = useState<string>('');
    const [paramsText, setParamsText] = useState<string>(() => ScriptStore.get().params);
    const [paramsErr, setParamsErr] = useState<string>('');
    const [activeName, setActiveName] = useState<string>(() =>
        stage === 'preprocess' ? ScriptStore.get().preprocess : ScriptStore.get().postprocess
    );
    const fileInputRef = useRef<HTMLInputElement>(null);

    const refresh = useCallback(async () => {
        try {
            setError('');
            const list = await fetchScripts();
            setScripts(list);
        } catch (e) {
            setError((e as Error).message);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const onParamsChange = (s: string) => {
        setParamsText(s);
        if (!s.trim()) {
            setParamsErr('');
            ScriptStore.set({params: ''});
            return;
        }
        try {
            const v = JSON.parse(s);
            if (!v || typeof v !== 'object' || Array.isArray(v)) {
                setParamsErr(zh ? '必须是 JSON 对象' : 'must be a JSON object');
                return;
            }
            setParamsErr('');
            ScriptStore.set({params: s});
        } catch (e) {
            setParamsErr((e as Error).message);
        }
    };

    const onSelect = (name: string) => {
        setActiveName(name);
        if (stage === 'preprocess') ScriptStore.set({preprocess: name});
        else ScriptStore.set({postprocess: name});
    };

    const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try {
            await uploadScript(f);
            await refresh();
        } catch (err) {
            setError((err as Error).message);
        }
    };

    const onDelete = async (name: string) => {
        if (!confirm((zh ? '删除脚本：' : 'Delete script: ') + name + '?')) return;
        try {
            await deleteScript(name);
            if (activeName === name) onSelect('');
            await refresh();
        } catch (err) {
            setError((err as Error).message);
        }
    };

    // 只显示带本 stage hook 的脚本（避免误选不支持的）
    const visibleScripts = scripts.filter(s => stage === 'preprocess' ? s.has_preprocess : s.has_postprocess);

    return (
        <div className='ParamSection'>
            <div className='ParamSectionTitle' onClick={() => setCollapsed(c => !c)}>
                {zh ? '[ 自定义 ]' : '[ Custom ]'}
                <span className='SectionTitleLine' />
                <span className={`SectionChevron${!collapsed ? ' open' : ''}`}>▾</span>
            </div>

            {!collapsed && <div style={{padding: '0 12px 12px'}}>
                {error && <div style={{color: '#e05c5c', fontSize: 11, marginBottom: 8}}>⚠ {error}</div>}

                {/* 列表 + 选择 */}
                <div style={{marginBottom: 10}}>
                    <label style={{display: 'flex', alignItems: 'center', padding: '4px 0', cursor: 'pointer', fontSize: 12}}>
                        <input
                            type='radio'
                            name={`script-${stage}`}
                            checked={activeName === ''}
                            onChange={() => onSelect('')}
                            style={{marginRight: 8}}
                        />
                        <span style={{color: '#888'}}>{zh ? '不启用' : 'None'}</span>
                    </label>
                    {visibleScripts.length === 0 && (
                        <div style={{color: '#666', fontSize: 11, padding: '4px 0', fontStyle: 'italic'}}>
                            {zh
                                ? `没有可用的 ${stage === 'preprocess' ? '前处理' : '后处理'} 脚本，上传一个 .py 文件吧`
                                : `No ${stage} scripts available — upload a .py file`}
                        </div>
                    )}
                    {visibleScripts.map(s => (
                        <div key={s.name} style={{display: 'flex', alignItems: 'center', padding: '3px 0', fontSize: 12}}>
                            <label style={{display: 'flex', alignItems: 'center', flex: 1, cursor: 'pointer'}}>
                                <input
                                    type='radio'
                                    name={`script-${stage}`}
                                    checked={activeName === s.name}
                                    onChange={() => onSelect(s.name)}
                                    style={{marginRight: 8}}
                                />
                                <span>{s.name}.py</span>
                                {s.has_preprocess && s.has_postprocess && (
                                    <span style={{color: '#5cc98a', fontSize: 10, marginLeft: 6}}>(pre+post)</span>
                                )}
                                {s.error && (
                                    <span style={{color: '#e05c5c', fontSize: 10, marginLeft: 6}} title={s.error}>(load error)</span>
                                )}
                            </label>
                            <button
                                onClick={() => onDelete(s.name)}
                                style={{background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14, padding: '0 4px'}}
                                title={zh ? '删除' : 'Delete'}
                            >×</button>
                        </div>
                    ))}
                </div>

                {/* 上传按钮 */}
                <div style={{display: 'flex', gap: 8, marginBottom: 10}}>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        style={{fontSize: 12, padding: '4px 10px', cursor: 'pointer'}}
                    >
                        {zh ? '+ 上传 .py' : '+ Upload .py'}
                    </button>
                    <button
                        onClick={refresh}
                        style={{fontSize: 12, padding: '4px 10px', cursor: 'pointer', background: 'transparent'}}
                    >
                        ↻ {zh ? '刷新' : 'Refresh'}
                    </button>
                    <input
                        ref={fileInputRef}
                        type='file'
                        accept='.py'
                        style={{display: 'none'}}
                        onChange={onUpload}
                    />
                </div>

                {/* params JSON */}
                <div>
                    <div style={{fontSize: 11, color: '#aaa', marginBottom: 4}}>
                        {zh ? '参数 (JSON 对象，传给脚本的 params 入参)' : 'Params (JSON object passed as `params` to the script)'}
                    </div>
                    <textarea
                        value={paramsText}
                        onChange={(e) => onParamsChange(e.target.value)}
                        placeholder='{}  // 留空即可，等同于不传任何参数'
                        rows={3}
                        style={{
                            width: '100%',
                            fontFamily: 'monospace',
                            fontSize: 11,
                            background: '#1e1e1e',
                            color: '#ddd',
                            border: paramsErr ? '1px solid #e05c5c' : '1px solid #444',
                            padding: 6,
                            borderRadius: 3,
                            resize: 'vertical',
                            boxSizing: 'border-box',
                        }}
                    />
                    {paramsErr && <div style={{color: '#e05c5c', fontSize: 10, marginTop: 2}}>JSON: {paramsErr}</div>}
                </div>

                <div style={{fontSize: 10, color: '#666', marginTop: 10, lineHeight: 1.5}}>
                    {zh
                        ? `规则：${stage === 'preprocess' ? 'def preprocess(image, params)' : 'def postprocess(detections, image, params)'}，详见 backend/scripts/example.py。`
                        : `Contract: ${stage === 'preprocess' ? 'def preprocess(image, params)' : 'def postprocess(detections, image, params)'}. See backend/scripts/example.py.`}
                </div>
            </div>}
        </div>
    );
};
