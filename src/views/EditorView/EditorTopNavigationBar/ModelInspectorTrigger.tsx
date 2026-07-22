import React, {useEffect, useState} from 'react';
import {Language} from '../../../data/LanguageConfig';
import {ModelInspectorAPI} from '../../PopupView/ModelInspectorPopup/ModelInspectorAPI';

interface IProps {
    backendKey: string;
    disabled: boolean;
    hasExtensionEngine: boolean;
    language: Language;
    onOpen: () => void;
}

export const ModelInspectorTrigger: React.FC<IProps> = ({
    backendKey,
    disabled,
    hasExtensionEngine,
    language,
    onOpen,
}) => {
    const [available, setAvailable] = useState(false);

    useEffect(() => {
        let active = true;
        let controller: AbortController | null = null;
        let probeRevision = 0;

        const probe = () => {
            if (!hasExtensionEngine) return;
            const revision = ++probeRevision;
            controller?.abort();
            controller = new AbortController();
            ModelInspectorAPI.status(controller.signal).then(status => {
                if (active && revision === probeRevision) setAvailable(status.status === 'ok');
            }).catch(() => {
                if (active && revision === probeRevision) setAvailable(false);
            });
        };
        const hideAndCancelProbe = () => {
            ++probeRevision;
            controller?.abort();
            controller = null;
            if (active) setAvailable(false);
        };
        const handleBackendStatus = (event: Event) => {
            const connected = (event as CustomEvent<{connected?: boolean}>).detail?.connected;
            if (connected === false) {
                hideAndCancelProbe();
            } else if (connected === true) {
                probe();
            }
        };

        setAvailable(false);
        if (hasExtensionEngine) probe();
        window.addEventListener('opensight:backend-status', handleBackendStatus);
        return () => {
            active = false;
            ++probeRevision;
            controller?.abort();
            window.removeEventListener('opensight:backend-status', handleBackendStatus);
        };
    }, [backendKey, hasExtensionEngine]);

    if (!hasExtensionEngine || !available) return null;
    return <button
        className='model-inspector-trigger'
        data-testid='open-model-inspector'
        disabled={disabled}
        onClick={onOpen}
        title={language === Language.CHINESE
            ? '查看当前图片在已加载模型各语义阶段的激活热图'
            : 'Inspect activation heatmaps across the loaded model stages'}
    >
        <span className='model-inspector-trigger-icon' aria-hidden='true'><i/><i/><i/></span>
        {language === Language.CHINESE ? '透视' : 'Inspect'}
    </button>;
};
