import {useCallback, useEffect, useRef, useState} from 'react';
import {ComputeClusterService, ComputeUpgradeManifest} from '../../../services/ComputeClusterService';

export const useComputeUpgradeReleases = (enabled = true) => {
    const [releases, setReleases] = useState<ComputeUpgradeManifest[]>([]);
    const [releasesLoading, setReleasesLoading] = useState(enabled);
    const [releasesError, setReleasesError] = useState('');
    const request = useRef<AbortController>();

    const refreshReleases = useCallback(async () => {
        if (!enabled) return;
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setReleasesLoading(true);
        setReleasesError('');
        try {
            const catalog = await ComputeClusterService.upgradeReleases(controller.signal);
            if (!controller.signal.aborted) setReleases(catalog.releases);
        } catch (reason) {
            if (!controller.signal.aborted) {
                setReleases([]);
                setReleasesError(reason instanceof Error ? reason.message : String(reason));
            }
        } finally {
            if (!controller.signal.aborted) setReleasesLoading(false);
        }
    }, [enabled]);

    useEffect(() => {
        void refreshReleases();
        return () => request.current?.abort();
    }, [refreshReleases]);

    return {releases, releasesLoading, releasesError, refreshReleases};
};
