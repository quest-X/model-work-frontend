import React, {useEffect, useRef, useState} from 'react';
import Hls from 'hls.js';
import {Copy, RefreshCw} from 'lucide-react';
import {Language} from '../../data/LanguageConfig';
import {ComputeClusterService} from '../../services/ComputeClusterService';
import CameraTimeline from '../EditorView/CameraTimeline/CameraTimeline';
import '../../vendor/mediamtx/reader.js';
import '../EditorView/CameraPlayer/CameraPlayer.scss';
import './ProgramLivePreview.scss';

type Protocol = 'mjpeg' | 'hls' | 'llhls' | 'webrtc' | 'rtsp' | 'srt';
type Reader = {close: () => void};
declare global {
    interface Window {
        MediaMTXWebRTCReader: new (options: {
            url: string;
            onTrack: (event: RTCTrackEvent) => void;
            onError: (error: string) => void;
        }) => Reader;
    }
}

const labels: Record<Protocol, string> = {
    mjpeg: 'MJPEG', hls: 'HLS', llhls: 'LL-HLS', webrtc: 'WebRTC', rtsp: 'RTSP', srt: 'SRT',
};

interface Props {
    nodeId: string;
    programId: string;
    name: string;
    path: string;
    zh: boolean;
}

// eslint-disable-next-line complexity
export const ProgramLivePreview: React.FC<Props> = ({nodeId, programId, name, path, zh}) => {
    const [protocol, setProtocol] = useState<Protocol>('mjpeg');
    const [protocols, setProtocols] = useState<Protocol[]>(['mjpeg']);
    const [nonce, setNonce] = useState(0);
    const [state, setState] = useState<'loading' | 'playing' | 'error'>('loading');
    const [error, setError] = useState('');
    const [externalUrl, setExternalUrl] = useState('');
    const [now, setNow] = useState(() => new Date());
    const [visible, setVisible] = useState(() => !document.hidden);
    const videoRef = useRef<HTMLVideoElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const accessController = useRef<AbortController | null>(null);
    const base = ComputeClusterService.programMediaUrl(nodeId, programId);
    const external = protocol === 'rtsp' || protocol === 'srt';
    const reconnect = () => setNonce(value => value + 1);

    useEffect(() => {
        const updateVisibility = () => setVisible(!document.hidden);
        document.addEventListener('visibilitychange', updateVisibility);
        return () => document.removeEventListener('visibilitychange', updateVisibility);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void fetch(base, {signal: controller.signal}).then(async response => {
            if (!response.ok) return;
            const descriptor = await response.json();
            if (!controller.signal.aborted && descriptor.schema_version === 'program.media.trial.v1') {
                setProtocols(descriptor.protocols.filter((id: Protocol) => id in labels));
            }
        }).catch(() => undefined);
        const timer = window.setInterval(() => setNow(new Date()), 1000);
        return () => {
            controller.abort();
            window.clearInterval(timer);
        };
    }, [base]);

    useEffect(() => {
        setState('loading');
        setError('');
        setExternalUrl('');
        accessController.current?.abort();
        if (external || !visible) return () => accessController.current?.abort();
        let disposed = false;
        let failed = false;
        const startedAt = Date.now();
        let lastFrameAt: number | undefined;
        let frames = 0;
        let hls: Hls | undefined;
        let reader: Reader | undefined;
        let timer = 0;
        const video = videoRef.current;
        const image = imageRef.current;
        const fail = (message: string) => {
            if (disposed || failed) return;
            failed = true;
            window.clearInterval(timer);
            setError(message);
            setState('error');
            hls?.destroy();
            reader?.close();
        };
        timer = window.setInterval(() => {
            if (protocol === 'mjpeg') return;
            const decoded = video?.getVideoPlaybackQuality?.().totalVideoFrames ?? video?.currentTime ?? 0;
            if (decoded > frames) {
                frames = decoded;
                lastFrameAt = Date.now();
                setState('playing');
            } else if (lastFrameAt !== undefined && Date.now() - lastFrameAt > 20000) {
                fail(zh ? '20 秒内未收到新视频帧' : 'No new video frame for 20 seconds');
            } else if (lastFrameAt === undefined && Date.now() - startedAt > 30000) {
                fail(zh ? '实时画面首帧加载超时' : 'Timed out loading the first video frame');
            }
        }, 1000);
        if (video && protocol === 'webrtc') {
            reader = new window.MediaMTXWebRTCReader({
                url: `${base}/webrtc/whep`,
                onTrack: event => {
                    if (!disposed && !failed) video.srcObject = event.streams[0];
                },
                onError: fail,
            });
        } else if (video && (protocol === 'hls' || protocol === 'llhls')) {
            const url = `${base}/${protocol}/index.m3u8`;
            if (Hls.isSupported()) {
                hls = new Hls({lowLatencyMode: protocol === 'llhls'});
                hls.on(Hls.Events.ERROR, (_event, data) => {
                    if (data.fatal) fail(`${data.details}${data.response ? ` (HTTP ${data.response.code})` : ''}`);
                });
                hls.loadSource(url);
                hls.attachMedia(video);
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
            } else {
                fail(zh ? '当前浏览器不支持 HLS' : 'HLS is not supported by this browser');
            }
        }
        return () => {
            disposed = true;
            window.clearInterval(timer);
            hls?.destroy();
            reader?.close();
            // Removing an img from the DOM alone can leave its MJPEG request running.
            image?.removeAttribute('src');
            if (video) {
                (video.srcObject as MediaStream | null)?.getTracks().forEach(track => track.stop());
                video.srcObject = null;
                video.removeAttribute('src');
                video.load();
            }
        };
    }, [base, external, nonce, protocol, visible, zh]);

    const loadExternalUrl = async () => {
        setError('');
        accessController.current?.abort();
        const controller = new AbortController();
        accessController.current = controller;
        try {
            const response = await fetch(`${base}/access/${protocol}`, {
                method: 'POST', signal: controller.signal,
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            if (!controller.signal.aborted) setExternalUrl(result.url);
        } catch (reason) {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
        }
    };

    return <section className='ControlProgramPreview' aria-label={zh ? '程序预览' : 'Program preview'}>
        <div className='ControlProgramLivePreview CameraPlayer'>
            <div className='CameraPlayerHeader'>
                <div className='CameraPlayerIdentity'>
                    <span className={`CameraLiveDot ${external ? 'loading' : state}`}/>
                    <strong>{name}</strong>
                    <span className='CameraLiveBadge'>{external ? (zh ? '外部播放' : 'EXTERNAL')
                        : state === 'playing' ? 'LIVE'
                            : state === 'error' ? (zh ? '连接失败' : 'FAILED')
                                : (zh ? '连接中' : 'CONNECTING')}</span>
                </div>
                <div className='CameraPlayerMeta'>
                    {protocols.length > 1 ? <select
                        aria-label={zh ? '播放协议' : 'Playback protocol'}
                        value={protocol}
                        onChange={event => setProtocol(event.target.value as Protocol)}
                    >{protocols.map(id => <option key={id} value={id}>{labels[id]}</option>)}</select>
                        : <span>{path}</span>}
                    <button type='button' onClick={reconnect} title={zh ? '重新连接' : 'Reconnect'}
                        aria-label={zh ? '重新连接' : 'Reconnect'}><RefreshCw size={16}/></button>
                </div>
            </div>
            <div className='CameraPlayerStage'>
                <div className='CameraComparePane effect'>
                    {external ? <div className='CameraPlayerNotice ProgramExternalStream'>
                        <strong>{labels[protocol]} · {zh ? '外部播放器' : 'External player'}</strong>
                        <button type='button' onClick={loadExternalUrl}>{zh ? '获取播放地址' : 'Get playback URL'}</button>
                        {externalUrl && <div className='ProgramExternalAddress'>
                            <input aria-label={zh ? '播放地址' : 'Playback URL'} readOnly value={externalUrl}/>
                            <button type='button' title={zh ? '复制地址' : 'Copy URL'}
                                aria-label={zh ? '复制地址' : 'Copy URL'}
                                onClick={() => {
                                    const input = document.querySelector<HTMLInputElement>('.ProgramExternalAddress input');
                                    input?.select();
                                    if (navigator.clipboard) void navigator.clipboard.writeText(externalUrl);
                                    else document.execCommand('copy');
                                }}><Copy size={16}/></button>
                        </div>}
                        {error && <span role='alert'>{error}</span>}
                    </div> : <>
                        {state === 'loading' && <div className='CameraPlayerNotice'>
                            <span className='CameraPlayerSpinner'/>
                            {zh ? '正在建立实时画面…' : 'Opening live stream…'}
                        </div>}
                        {state === 'error' && <div className='CameraPlayerNotice error'>
                            <strong>{zh ? '实时画面连接失败' : 'Unable to open live stream'}</strong>
                            <span>{error || (zh ? `请检查程序状态和 ${path} 接口。` : `Check the program and ${path} API.`)}</span>
                            <button type='button' onClick={reconnect}>{zh ? '重试' : 'Retry'}</button>
                        </div>}
                        {visible && (protocol === 'mjpeg' ? <img ref={imageRef}
                            key={nonce}
                            src={`${ComputeClusterService.programInterfaceStreamUrl(nodeId, programId, path)}&v=${nonce}`}
                            alt={zh ? `${name} 现场实时画面` : `${name} live site preview`}
                            style={{visibility: state === 'error' ? 'hidden' : 'visible'}}
                            onLoad={() => setState('playing')}
                            onError={() => setState('error')}
                            draggable={false}
                        /> : <video key={`${protocol}-${nonce}`} ref={videoRef} autoPlay muted playsInline
                            aria-label={zh ? `${name} 现场实时画面` : `${name} live site preview`}
                            onPlaying={() => setState('playing')}
                            onError={() => {
                                setError(videoRef.current?.error?.message || 'Video decode error');
                                setState('error');
                            }}/>)}
                    </>}
                </div>
            </div>
            <CameraTimeline language={zh ? Language.CHINESE : Language.ENGLISH} dayTime={now}/>
        </div>
    </section>;
};
