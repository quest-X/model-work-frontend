import {
    IndexedDBManager,
    RecoverySnapshotChangedError,
    RecoverySnapshotUnavailableError,
    RecoveryStorageReadError,
    StoredProjectData,
} from '../IndexedDBManager';
import {QueueItemStatus, QueueItemType} from '../../store/queue/types';
import type {LabelRect} from '../../store/labels/types';
import {LabelStatus} from '../../data/enums/LabelStatus';

const rectangle = (id: string): LabelRect => ({
    id, labelId: 'steel', rect: {x: 1, y: 2, width: 3, height: 4},
    isVisible: true, isCreatedByAI: false, status: LabelStatus.ACCEPTED, suggestedLabel: '',
});

const project = (): StoredProjectData => ({
    id: 'current-project',
    images: [],
    labelNames: [],
    currentImageIndex: 0,
    lastModified: 1,
    version: 'legacy',
});

// Private bracket access keeps these focused regression tests checked against
// the actual implementation without widening the production API.
const originalMethods = {
    generateWorkspaceId: IndexedDBManager['generateWorkspaceId'],
    resolveProjectLocation: IndexedDBManager['resolveProjectLocation'],
    readProjectById: IndexedDBManager['readProjectById'],
    readWorkspaceMeta: IndexedDBManager['readWorkspaceMeta'],
    readLatestWorkspaceMeta: IndexedDBManager['readLatestWorkspaceMeta'],
    claimWorkspaceLock: IndexedDBManager['claimWorkspaceLock'],
};
const mockMethod = <K extends keyof typeof originalMethods>(name: K) => {
    const mock = jest.fn<ReturnType<typeof originalMethods[K]>, Parameters<typeof originalMethods[K]>>();
    Object.defineProperty(IndexedDBManager, name, {value: mock, writable: true, configurable: true});
    return mock;
};

type StoredMeta = ReturnType<typeof IndexedDBManager['buildMeta']>;
type StoredRecord = StoredProjectData | StoredMeta;
type FakeRequest<T = unknown> = {
    -readonly [K in 'result' | 'error']?: IDBRequest<T>[K];
} & {
    onsuccess?: () => void;
    onerror?: () => void;
    onblocked?: () => void;
};
// Only transaction operations reached by these tests are stubbed. Real commit
// and abort notifications remain independently controlled by each test.
const setDatabase = (transaction?: () => {
    error: IDBTransaction['error'];
    objectStore: (name: string) => object;
}): void => {
    // Install an intentionally partial browser fixture at the test boundary;
    // do not claim it implements unrelated IDBDatabase methods.
    Object.defineProperty(IndexedDBManager, 'db', {
        value: {close: jest.fn(), transaction}, writable: true, configurable: true,
    });
};

type FakeTransaction = {
    error: IDBTransaction['error'];
    oncomplete?: () => void;
    onabort?: () => void;
    onerror?: () => void;
    objectStore: (name: string) => {
        put: (value: StoredRecord) => {onerror?: () => void};
        delete: (key: string) => {onerror?: () => void};
    };
};

const transactionHarness = () => {
    const puts: Array<{store: string; value: StoredRecord}> = [];
    const deletes: Array<{store: string; key: string}> = [];
    const transaction: FakeTransaction = {
        error: null,
        objectStore: (name: string) => ({
            put: (value: StoredRecord) => {
                puts.push({store: name, value});
                return {};
            },
            delete: (key: string) => {
                deletes.push({store: name, key});
                return {};
            },
        }),
    };
    return {transaction, puts, deletes};
};

describe('IndexedDBManager durability', () => {
    afterEach(() => {
        IndexedDBManager['workspaceLockRelease']?.();
        IndexedDBManager['workspaceChannel']?.close?.();
        jest.restoreAllMocks();
        jest.useRealTimers();
        sessionStorage.clear();
        Object.assign(IndexedDBManager, originalMethods, {
            db: null,
            initializePromise: null,
            workspaceId: null,
            workspaceIdWasRestored: false,
            workspaceIdentityInitialized: false,
            workspaceLockPromise: null,
            workspaceLockRelease: null,
            workspaceChannel: null,
            activeReadProjectId: null,
            activeReadWorkspaceId: null,
            activeReadLastModified: null,
            pinnedReadLocation: null,
            dismissedForeignSnapshots: null,
        });
    });

    it('hands the writer to an available history workspace only after checking its revision', async () => {
        const previousRelease = jest.fn();
        const nextRelease = jest.fn();
        Object.assign(IndexedDBManager, {workspaceId: 'old', workspaceLockRelease: previousRelease});
        mockMethod('claimWorkspaceLock').mockImplementation(async () => {
            IndexedDBManager['workspaceLockRelease'] = nextRelease;
            return true;
        });
        mockMethod('readWorkspaceMeta').mockResolvedValue({lastModified: 10} as never);
        await IndexedDBManager.activateWorkspace('target', 10);
        expect(IndexedDBManager.getWorkspaceId()).toBe('target');
        expect(sessionStorage.getItem('opensight-recovery-workspace-id')).toBe('target');
        expect(previousRelease).toHaveBeenCalledTimes(1);
        expect(nextRelease).not.toHaveBeenCalled();
        const harness = transactionHarness();
        setDatabase(() => harness.transaction);
        const saving = IndexedDBManager.saveProject(project());
        harness.transaction.oncomplete?.();
        await expect(saving).resolves.toBe(true);
        expect(harness.puts.find(put => put.store === 'projects')?.value.id).toBe('workspace:target');
        expect(harness.deletes.some(entry => entry.key === 'workspace:old')).toBe(false);
    });

    it.each([false, null])('forks a separate writer when the history lock is %s', async claimed => {
        Object.assign(IndexedDBManager, {workspaceId: 'old'});
        mockMethod('generateWorkspaceId').mockReturnValue('isolated-copy');
        const claim = mockMethod('claimWorkspaceLock').mockResolvedValueOnce(claimed).mockResolvedValueOnce(claimed);
        if (claimed === false) claim.mockReset().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        mockMethod('readWorkspaceMeta').mockResolvedValue({lastModified: 10} as never);
        await IndexedDBManager.activateWorkspace('target', 10);
        expect(IndexedDBManager.getWorkspaceId()).toBe('isolated-copy');
        expect(claim.mock.calls.map(([id]) => id)).toEqual(['target', 'isolated-copy']);
        const harness = transactionHarness();
        setDatabase(() => harness.transaction);
        const saving = IndexedDBManager.saveProject(project());
        harness.transaction.oncomplete?.();
        await expect(saving).resolves.toBe(true);
        expect(harness.puts.find(put => put.store === 'projects')?.value.id).toBe('workspace:isolated-copy');
        expect(harness.deletes.some(entry => entry.key === 'workspace:target' || entry.key === 'workspace:old')).toBe(false);
    });

    it('retains the old writer and releases the candidate lock when history changes before commit', async () => {
        const previousRelease = jest.fn();
        const nextRelease = jest.fn();
        Object.assign(IndexedDBManager, {workspaceId: 'old', workspaceLockRelease: previousRelease});
        mockMethod('claimWorkspaceLock').mockImplementation(async () => {
            IndexedDBManager['workspaceLockRelease'] = nextRelease;
            return true;
        });
        mockMethod('readWorkspaceMeta').mockResolvedValue({lastModified: 11} as never);
        await expect(IndexedDBManager.activateWorkspace('target', 10)).rejects.toBeInstanceOf(RecoverySnapshotChangedError);
        expect(IndexedDBManager.getWorkspaceId()).toBe('old');
        expect(nextRelease).toHaveBeenCalledTimes(1);
        expect(previousRelease).not.toHaveBeenCalled();
        expect(IndexedDBManager['workspaceLockRelease']).toBe(previousRelease);
    });

    it('keeps a restored workspace identity on reload when Web Locks are unavailable', async () => {
        const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
        const originalBroadcastChannel = globalThis.BroadcastChannel;
        const originalGetEntries = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');
        Object.defineProperty(navigator, 'locks', {configurable: true, value: undefined});
        Object.defineProperty(globalThis, 'BroadcastChannel', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        Object.defineProperty(performance, 'getEntriesByType', {
            configurable: true,
            value: jest.fn(() => [{type: 'reload'} as PerformanceNavigationTiming]),
        });
        sessionStorage.setItem('opensight-recovery-workspace-id', 'tab-stable');

        try {
            await IndexedDBManager['initializeWorkspaceIdentity']();

            expect(IndexedDBManager.getWorkspaceId()).toBe('tab-stable');
        } finally {
            if (originalLocks) {
                Object.defineProperty(navigator, 'locks', originalLocks);
            } else {
                Reflect.deleteProperty(navigator, 'locks');
            }
            Object.defineProperty(globalThis, 'BroadcastChannel', {
                configurable: true,
                writable: true,
                value: originalBroadcastChannel,
            });
            if (originalGetEntries) {
                Object.defineProperty(performance, 'getEntriesByType', originalGetEntries);
            } else {
                Reflect.deleteProperty(performance, 'getEntriesByType');
            }
        }
    });

    it('allocates a new workspace identity for an independent tab session', () => {
        mockMethod('generateWorkspaceId')
            .mockReturnValueOnce('tab-a')
            .mockReturnValueOnce('tab-b');

        const firstTab = IndexedDBManager.getWorkspaceId();
        sessionStorage.clear();
        IndexedDBManager['workspaceId'] = null;
        const secondTab = IndexedDBManager.getWorkspaceId();

        expect(firstTab).toBe('tab-a');
        expect(secondTab).toBe('tab-b');
    });

    it('rotates a cloned identity when the live tab owns its lifetime Web Lock', async () => {
        const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
        const originalBroadcastChannel = globalThis.BroadcastChannel;
        class DelayedBroadcastChannel {
            public onmessage: BroadcastChannel['onmessage'] = null;

            public postMessage(): void {
                // A frozen source tab never responds during initialization.
            }

            public close(): void {
                // Test channel owns no native resources.
            }
        }
        const request = jest.fn((name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>) =>
            Promise.resolve(callback(name.endsWith('cloned-tab') ? null : {name, mode: 'exclusive'})),
        );
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: {request},
        });
        Object.defineProperty(globalThis, 'BroadcastChannel', {
            configurable: true,
            writable: true,
            value: DelayedBroadcastChannel,
        });
        sessionStorage.setItem('opensight-recovery-workspace-id', 'cloned-tab');
        mockMethod('generateWorkspaceId')
            .mockReturnValue('rotated-tab');

        try {
            await IndexedDBManager['initializeWorkspaceIdentity']();

            expect(IndexedDBManager.getWorkspaceId()).toBe('rotated-tab');
            expect(sessionStorage.getItem('opensight-recovery-workspace-id'))
                .toBe('rotated-tab');
            expect(request).toHaveBeenNthCalledWith(
                1,
                'opensight-recovery-workspace:cloned-tab',
                {mode: 'exclusive', ifAvailable: true},
                expect.any(Function),
            );
            expect(request).toHaveBeenNthCalledWith(
                2,
                'opensight-recovery-workspace:rotated-tab',
                {mode: 'exclusive', ifAvailable: true},
                expect.any(Function),
            );
        } finally {
            IndexedDBManager['workspaceLockRelease']?.();
            if (originalLocks) {
                Object.defineProperty(navigator, 'locks', originalLocks);
            } else {
                Reflect.deleteProperty(navigator, 'locks');
            }
            Object.defineProperty(globalThis, 'BroadcastChannel', {
                configurable: true,
                writable: true,
                value: originalBroadcastChannel,
            });
        }
    });

    it('waits briefly for the previous reload document to hand off its Web Lock', async () => {
        const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
        const originalBroadcastChannel = globalThis.BroadcastChannel;
        const originalGetEntries = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');
        let grantLock: (() => void) | null = null;
        const request = jest.fn((name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) =>
            new Promise((resolve, reject) => {
                grantLock = () => resolve(callback({name, mode: 'exclusive'}));
                options.signal?.addEventListener('abort', () => {
                    reject(new DOMException('handoff timed out', 'AbortError'));
                });
            }),
        );
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: {request},
        });
        Object.defineProperty(globalThis, 'BroadcastChannel', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        Object.defineProperty(performance, 'getEntriesByType', {
            configurable: true,
            value: jest.fn(() => [{type: 'reload'} as PerformanceNavigationTiming]),
        });
        sessionStorage.setItem('opensight-recovery-workspace-id', 'reload-tab');
        const generateWorkspaceId = mockMethod('generateWorkspaceId');

        try {
            const initializing = IndexedDBManager['initializeWorkspaceIdentity']();
            expect(grantLock).not.toBeNull();
            if (!grantLock) throw new Error('Expected the pending Web Lock request');
            grantLock();
            await initializing;

            expect(IndexedDBManager.getWorkspaceId()).toBe('reload-tab');
            expect(generateWorkspaceId).not.toHaveBeenCalled();
            expect(request).toHaveBeenCalledWith(
                'opensight-recovery-workspace:reload-tab',
                expect.objectContaining({
                    mode: 'exclusive',
                    signal: expect.any(AbortSignal),
                }),
                expect.any(Function),
            );
            expect(request.mock.calls[0][1]).not.toHaveProperty('ifAvailable');
        } finally {
            IndexedDBManager['workspaceLockRelease']?.();
            if (originalLocks) {
                Object.defineProperty(navigator, 'locks', originalLocks);
            } else {
                Reflect.deleteProperty(navigator, 'locks');
            }
            Object.defineProperty(globalThis, 'BroadcastChannel', {
                configurable: true,
                writable: true,
                value: originalBroadcastChannel,
            });
            if (originalGetEntries) {
                Object.defineProperty(performance, 'getEntriesByType', originalGetEntries);
            } else {
                Reflect.deleteProperty(performance, 'getEntriesByType');
            }
        }
    });

    it('rotates a navigated cloned identity without Web Locks or BroadcastChannel', async () => {
        const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
        const originalBroadcastChannel = globalThis.BroadcastChannel;
        const originalGetEntries = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');
        Object.defineProperty(navigator, 'locks', {configurable: true, value: undefined});
        Object.defineProperty(globalThis, 'BroadcastChannel', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        Object.defineProperty(performance, 'getEntriesByType', {
            configurable: true,
            value: jest.fn(() => [{type: 'navigate'} as PerformanceNavigationTiming]),
        });
        sessionStorage.setItem('opensight-recovery-workspace-id', 'cloned-tab');
        mockMethod('generateWorkspaceId')
            .mockReturnValue('rotated-without-channel');

        try {
            await IndexedDBManager['initializeWorkspaceIdentity']();

            expect(IndexedDBManager.getWorkspaceId()).toBe('rotated-without-channel');
        } finally {
            if (originalLocks) {
                Object.defineProperty(navigator, 'locks', originalLocks);
            } else {
                Reflect.deleteProperty(navigator, 'locks');
            }
            Object.defineProperty(globalThis, 'BroadcastChannel', {
                configurable: true,
                writable: true,
                value: originalBroadcastChannel,
            });
            if (originalGetEntries) {
                Object.defineProperty(performance, 'getEntriesByType', originalGetEntries);
            } else {
                Reflect.deleteProperty(performance, 'getEntriesByType');
            }
        }
    });

    it('bounds a blocked database upgrade and permits a later retry', async () => {
        jest.useFakeTimers();
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const originalIndexedDB = window.indexedDB;
        const lateDatabase = {close: jest.fn()};
        const request: FakeRequest<typeof lateDatabase> = {result: lateDatabase};
        const open = jest.fn(() => request);
        Object.defineProperty(window, 'indexedDB', {
            configurable: true,
            value: {open},
        });
        IndexedDBManager['workspaceIdentityInitialized'] = true;

        try {
            const initializing = IndexedDBManager.initialize();
            await Promise.resolve();
            await Promise.resolve();
            expect(open).toHaveBeenCalledTimes(1);
            request.onblocked?.();

            jest.advanceTimersByTime(IndexedDBManager['OPEN_TIMEOUT_MS']);
            await expect(initializing).resolves.toBe(false);
            expect(IndexedDBManager['initializePromise']).toBeNull();
            expect(IndexedDBManager.isReady()).toBe(false);

            request.onsuccess?.();
            expect(lateDatabase.close).toHaveBeenCalledTimes(1);
        } finally {
            Object.defineProperty(window, 'indexedDB', {
                configurable: true,
                value: originalIndexedDB,
            });
        }
    });

    it('exposes database readiness without mutating initialization state', () => {
        expect(IndexedDBManager.isReady()).toBe(false);
        setDatabase();
        expect(IndexedDBManager.isReady()).toBe(true);
    });

    it('reports success only after transaction commit and false on a later abort', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const harness = transactionHarness();
        setDatabase(() => harness.transaction);
        IndexedDBManager['workspaceId'] = 'tab-a';
        IndexedDBManager['activeReadProjectId'] = 'workspace:tab-foreign';
        IndexedDBManager['activeReadWorkspaceId'] = 'tab-foreign';
        IndexedDBManager['activeReadLastModified'] = 41;
        let settled = false;

        const saving = IndexedDBManager.saveProject(project()).then(result => {
            settled = true;
            return result;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        harness.transaction.error = new DOMException('QuotaExceededError', 'QuotaExceededError');
        harness.transaction.onabort?.();
        await expect(saving).resolves.toBe(false);
        expect(sessionStorage.getItem('opensight-recovery-dismissed-foreign-snapshot'))
            .toBeNull();
        expect(IndexedDBManager['activeReadWorkspaceId']).toBe('tab-foreign');
    });

    it('dismisses the consumed foreign revision only after the first local save commits', async () => {
        const harness = transactionHarness();
        setDatabase(() => harness.transaction);
        IndexedDBManager['workspaceId'] = 'tab-local';
        IndexedDBManager['activeReadProjectId'] = 'workspace:tab-foreign';
        IndexedDBManager['activeReadWorkspaceId'] = 'tab-foreign';
        IndexedDBManager['activeReadLastModified'] = 41;

        const saving = IndexedDBManager.saveProject(project());
        expect(sessionStorage.getItem('opensight-recovery-dismissed-foreign-snapshot'))
            .toBeNull();
        harness.transaction.oncomplete?.();

        await expect(saving).resolves.toBe(true);
        expect(JSON.parse(sessionStorage.getItem(
            'opensight-recovery-dismissed-foreign-snapshot',
        ) || '{}')).toEqual({
            workspaceId: 'tab-local',
            revisions: {'tab-foreign': 41},
        });
        expect(IndexedDBManager['activeReadWorkspaceId']).toBe('tab-local');
    });

    it('does not mistake a failed metadata read for an empty recovery store', async () => {
        const request: FakeRequest = {error: new DOMException('temporary read failure')};
        const transaction = {
            error: null,
            objectStore: () => ({get: () => request}),
        };
        setDatabase(() => transaction);

        const reading = IndexedDBManager['readWorkspaceMeta']('tab-a');
        request.onerror?.();

        await expect(reading).rejects.toBeInstanceOf(RecoveryStorageReadError);
    });

    it('isolates project records by workspace key instead of current-project', async () => {
        const first = transactionHarness();
        const second = transactionHarness();
        const transactions = [first.transaction, second.transaction];
        setDatabase(() => {
            const transaction = transactions.shift();
            if (!transaction) throw new Error('Unexpected third transaction');
            return transaction;
        });

        IndexedDBManager['workspaceId'] = 'tab-a';
        const saveA = IndexedDBManager.saveProject(project());
        first.transaction.oncomplete?.();
        await expect(saveA).resolves.toBe(true);

        IndexedDBManager['workspaceId'] = 'tab-b';
        const saveB = IndexedDBManager.saveProject(project());
        second.transaction.oncomplete?.();
        await expect(saveB).resolves.toBe(true);

        const projectA = first.puts.find(entry => entry.store === 'projects')?.value;
        const projectB = second.puts.find(entry => entry.store === 'projects')?.value;
        expect(projectA.id).toBe('workspace:tab-a');
        expect(projectB.id).toBe('workspace:tab-b');
        expect(projectA.id).not.toBe(projectB.id);
    });

    it('clears only this workspace and legacy data after viewing another tab snapshot', async () => {
        const harness = transactionHarness();
        setDatabase(() => harness.transaction);
        IndexedDBManager['workspaceId'] = 'tab-local';
        IndexedDBManager['activeReadProjectId'] = 'workspace:tab-foreign';
        IndexedDBManager['activeReadWorkspaceId'] = 'tab-foreign';
        IndexedDBManager['activeReadLastModified'] = 41;

        const clearing = IndexedDBManager.clearProject();
        harness.transaction.oncomplete?.();
        await expect(clearing).resolves.toBe(true);

        expect(harness.deletes).toEqual(expect.arrayContaining([
            {store: 'projects', key: 'workspace:tab-local'},
            {store: 'projects', key: 'current-project'},
            {store: 'workspaceMeta', key: 'tab-local'},
        ]));
        expect(harness.deletes).not.toEqual(expect.arrayContaining([
            expect.objectContaining({key: 'workspace:tab-foreign'}),
        ]));
        expect(harness.deletes).not.toEqual(expect.arrayContaining([
            expect.objectContaining({key: 'tab-foreign'}),
        ]));
        expect(JSON.parse(sessionStorage.getItem(
            'opensight-recovery-dismissed-foreign-snapshot',
        ) || '{}')).toEqual({
            workspaceId: 'tab-local',
            revisions: {'tab-foreign': 41},
        });
    });

    it('deletes only the selected historical revision after both stores commit', async () => {
        const harness = transactionHarness();
        const request: FakeRequest<StoredMeta> = {};
        const transaction = {
            ...harness.transaction,
            objectStore: (name: string) => ({
                ...harness.transaction.objectStore(name),
                get: () => request,
            }),
        };
        setDatabase(() => transaction);
        IndexedDBManager['workspaceId'] = 'tab-local';

        const deleting = IndexedDBManager.deleteAnnotatedProject('tab-foreign', 41);
        request.result = {
            id: 'tab-foreign', projectId: 'workspace:tab-foreign',
            imageCount: 1, validImageCount: 1, labelCount: 1,
            isVideoProject: false, hasRecoverableProject: true, lastModified: 41,
        };
        request.onsuccess?.();
        expect(harness.deletes).toEqual([
            {store: 'projects', key: 'workspace:tab-foreign'},
            {store: 'workspaceMeta', key: 'tab-foreign'},
        ]);
        transaction.oncomplete?.();
        await expect(deleting).resolves.toBe(true);
        await expect(IndexedDBManager.deleteAnnotatedProject('tab-local', 41)).resolves.toBe(false);

        const deletingCurrent = IndexedDBManager.deleteAnnotatedProject('tab-local', 42, true);
        request.result = {
            ...request.result, id: 'tab-local', projectId: 'workspace:tab-local', lastModified: 42,
        };
        request.onsuccess?.();
        transaction.oncomplete?.();
        await expect(deletingCurrent).resolves.toBe(true);
        expect(harness.deletes.slice(-2)).toEqual([
            {store: 'projects', key: 'workspace:tab-local'},
            {store: 'workspaceMeta', key: 'tab-local'},
        ]);
    });

    it('hides a dismissed foreign revision but offers a newer save from that workspace', async () => {
        sessionStorage.setItem('opensight-recovery-dismissed-foreign-snapshot', JSON.stringify({
            workspaceId: 'tab-local',
            revisions: {'tab-foreign': 41},
        }));
        const readLatest = async (lastModified: number): Promise<StoredMeta | null> => {
            const request: FakeRequest<{value: StoredMeta; continue: () => void} | null> = {};
            const cursor = {
                value: {
                    id: 'tab-foreign',
                    projectId: 'workspace:tab-foreign',
                    imageCount: 1,
                    validImageCount: 1,
                    labelCount: 0,
                    isVideoProject: false,
                    hasRecoverableProject: true,
                    lastModified,
                },
                continue: () => {
                    request.result = null;
                    request.onsuccess?.();
                },
            };
            const transaction = {
                error: null,
                objectStore: () => ({
                    index: () => ({openCursor: () => request}),
                }),
            };
            setDatabase(() => transaction);
            IndexedDBManager['dismissedForeignSnapshots'] = null;

            const reading = IndexedDBManager['readLatestWorkspaceMeta']('tab-local');
            request.result = cursor;
            request.onsuccess?.();
            return reading;
        };

        await expect(readLatest(41)).resolves.toBeNull();
        await expect(readLatest(42)).resolves.toEqual(expect.objectContaining({
            id: 'tab-foreign',
            lastModified: 42,
        }));
    });

    it('does not persist a foreign dismissal when clear aborts', async () => {
        const harness = transactionHarness();
        setDatabase(() => harness.transaction);
        IndexedDBManager['workspaceId'] = 'tab-local';
        IndexedDBManager['activeReadProjectId'] = 'workspace:tab-foreign';
        IndexedDBManager['activeReadWorkspaceId'] = 'tab-foreign';
        IndexedDBManager['activeReadLastModified'] = 41;

        const clearing = IndexedDBManager.clearProject();
        harness.transaction.onabort?.();

        await expect(clearing).resolves.toBe(false);
        expect(sessionStorage.getItem('opensight-recovery-dismissed-foreign-snapshot'))
            .toBeNull();
    });

    it('loads a foreign snapshot as copy-on-write without an eager durable copy', async () => {
        const foreignProject = {...project(), id: 'workspace:tab-foreign', workspaceId: 'tab-foreign'};
        setDatabase();
        IndexedDBManager['workspaceId'] = 'tab-local';
        mockMethod('resolveProjectLocation').mockResolvedValue({
            projectId: 'workspace:tab-foreign',
            workspaceId: 'tab-foreign',
            meta: {imageCount: 0, validImageCount: 0, labelCount: 0,
                isVideoProject: false, hasRecoverableProject: false, lastModified: 1},
        });
        mockMethod('readProjectById').mockResolvedValue(foreignProject);
        const saveProject = jest.spyOn(IndexedDBManager, 'saveProject').mockResolvedValue(true);

        const loaded = await IndexedDBManager.loadProject();

        expect(saveProject).not.toHaveBeenCalled();
        expect(loaded).toEqual(expect.objectContaining({workspaceId: 'tab-local'}));
        expect(foreignProject.workspaceId).toBe('tab-foreign');
    });

    it('loads a legacy record as copy-on-write for the current workspace', async () => {
        const legacy = project();
        setDatabase();
        IndexedDBManager['workspaceId'] = 'tab-new';
        mockMethod('readWorkspaceMeta').mockResolvedValue(null);
        mockMethod('readLatestWorkspaceMeta').mockResolvedValue(null);
        mockMethod('readProjectById').mockResolvedValue(legacy);
        const saveProject = jest.spyOn(IndexedDBManager, 'saveProject').mockResolvedValue(true);

        const loaded = await IndexedDBManager.loadProject();

        expect(loaded).toEqual(expect.objectContaining({workspaceId: 'tab-new'}));
        expect(saveProject).not.toHaveBeenCalled();
    });

    it('pins the prompt selection when a different workspace saves before confirmation', async () => {
        const locationA = {
            projectId: 'workspace:tab-a',
            workspaceId: 'tab-a',
            meta: {
                imageCount: 1,
                validImageCount: 1,
                labelCount: 0,
                isVideoProject: false,
                hasRecoverableProject: true,
                lastModified: 10,
            },
        };
        const locationB = {
            ...locationA,
            projectId: 'workspace:tab-b',
            workspaceId: 'tab-b',
            meta: {...locationA.meta, lastModified: 20},
        };
        let latestLocation = locationA;
        setDatabase();
        IndexedDBManager['workspaceId'] = 'tab-local';
        const resolveLocation = mockMethod('resolveProjectLocation')
            .mockImplementation(async () => latestLocation);
        const readProject = mockMethod('readProjectById')
            .mockImplementation(async projectId => {
                return projectId === locationA.projectId
                    ? {...project(), id: projectId, workspaceId: 'tab-a', lastModified: 10, version: 'A'}
                    : {...project(), id: projectId, workspaceId: 'tab-b', lastModified: 20, version: 'B'};
            });

        await expect(IndexedDBManager.getProjectMeta()).resolves.toEqual(locationA.meta);
        latestLocation = locationB;
        const loaded = await IndexedDBManager.loadProject();

        expect(resolveLocation).toHaveBeenCalledTimes(1);
        expect(readProject).toHaveBeenCalledWith('workspace:tab-a');
        expect(loaded).toEqual(expect.objectContaining({version: 'A', workspaceId: 'tab-local'}));
    });

    it('lists only annotated recoverable snapshots and reads names from older records', async () => {
        const annotated = {
            id: 'task-a', projectId: 'workspace:task-a', imageCount: 8,
            validImageCount: 8, labelCount: 5, isVideoProject: true,
            hasRecoverableProject: true, lastModified: 20,
        };
        const empty = {...annotated, id: 'task-b', projectId: 'workspace:task-b', labelCount: 0};
        const imageTask = {...annotated, id: 'task-c', projectId: 'workspace:task-c',
            isVideoProject: false, lastModified: 10};
        const request: FakeRequest<Array<typeof annotated>> = {result: [empty, imageTask, annotated]};
        setDatabase(() => ({
            error: null,
            objectStore: () => ({
                getAll: () => {
                    queueMicrotask(() => request.onsuccess?.());
                    return request;
                },
            }),
        }));
        const firstImageFileData = new Uint8Array([1, 2, 3]).buffer;
        const readProject = mockMethod('readProjectById').mockImplementation(async projectId =>
            projectId === 'workspace:task-c' ? {
                ...project(), activeQueueItemId: 'image',
                queueItems: [{id: 'image', name: 'first.jpg', type: QueueItemType.IMAGE,
                    status: QueueItemStatus.COMPLETED, uploadedAt: 1}],
                images: [{id: 'first', fileName: 'first.jpg', fileData: firstImageFileData,
                    fileType: 'image/jpeg', loadStatus: true, labelRects: [rectangle('first')],
                    labelPoints: [], labelLines: [], labelPolygons: [], labelNameIds: ['steel']}],
            } : {
                ...project(), activeQueueItemId: 'video',
                queueItems: [{
                    id: 'video', name: 'dog_4166347', type: QueueItemType.VIDEO,
                    thumbnail: 'data:image/png;base64,first-frame',
                    extractionMetadata: {fps: 30, duration: 8 / 30, totalFrames: 8, width: 640, height: 480},
                    status: QueueItemStatus.COMPLETED, uploadedAt: 1,
                }],
            });

        await expect(IndexedDBManager.listAnnotatedProjects()).resolves.toEqual([
            expect.objectContaining({workspaceId: 'task-a', projectName: 'dog_4166347',
                thumbnail: 'data:image/png;base64,first-frame', labelCount: 5,
                queueDisplay: expect.objectContaining({name: 'dog_4166347', totalFrames: 8, fps: 30})}),
            expect.objectContaining({workspaceId: 'task-c', projectName: 'first.jpg',
                firstImageFileData, firstImageFileType: 'image/jpeg'}),
        ]);
        expect(readProject).toHaveBeenCalledWith('workspace:task-a');
        expect(readProject).toHaveBeenCalledWith('workspace:task-c');
    });

    it('keeps indexed queue details when an older payload cannot reconstruct them', async () => {
        const queueDisplay = {name: 'source.mp4', type: QueueItemType.VIDEO, totalFrames: 120, fps: 30};
        mockMethod('readProjectById').mockResolvedValue({
            ...project(), projectName: undefined, queueItems: [],
            videoRecovery: undefined, extractionMetadata: undefined,
        });
        await expect(IndexedDBManager['historyEntryFromRecord']({
            id: 'older-task', projectId: 'workspace:older-task', projectName: 'source',
            imageCount: 120, validImageCount: 120, labelCount: 1, isVideoProject: true,
            hasRecoverableProject: true, lastModified: 1, queueDisplay,
        })).resolves.toMatchObject({projectName: 'source', queueDisplay});
    });

    it('stores the active queue title metadata in new history indexes', () => {
        const videoProject: StoredProjectData = {
            ...project(), projectName: 'cat_7429360', isVideoProject: true,
            queueItems: [{
                id: 'video', name: 'cat_7429360', type: QueueItemType.VIDEO,
                status: QueueItemStatus.COMPLETED, uploadedAt: 1,
                extractionMetadata: {fps: 30, duration: 30, totalFrames: 900, width: 640, height: 480},
            }],
            activeQueueItemId: 'video',
        };
        expect(IndexedDBManager['buildMeta'](videoProject, 'task', 'workspace:task', 1).queueDisplay)
            .toEqual({name: 'cat_7429360', type: QueueItemType.VIDEO,
                totalFrames: 900, fps: 30, fileCount: undefined});
    });

    it('pins a specifically selected historical snapshot for restore', async () => {
        const meta = {
            id: 'task-a', projectId: 'workspace:task-a', projectName: 'dog_4166347',
            imageCount: 8, validImageCount: 8, labelCount: 5,
            isVideoProject: true, hasRecoverableProject: true, lastModified: 20,
        };
        setDatabase();
        IndexedDBManager['workspaceId'] = 'tab-local';
        mockMethod('readWorkspaceMeta').mockResolvedValue(meta);
        const resolveLatest = mockMethod('resolveProjectLocation');
        mockMethod('readProjectById').mockResolvedValue({
            ...project(), id: meta.projectId, lastModified: meta.lastModified,
        });

        await expect(IndexedDBManager.getProjectMeta('task-a')).resolves.toEqual(
            expect.objectContaining({projectName: 'dog_4166347'}),
        );
        await expect(IndexedDBManager.loadProject()).resolves.toEqual(
            expect.objectContaining({workspaceId: 'tab-local'}),
        );
        expect(resolveLatest).not.toHaveBeenCalled();
    });

    it('reclassifies legacy empty metadata when the stored project is a camera workspace', async () => {
        const location = {
            projectId: 'workspace:tab-camera',
            workspaceId: 'tab-camera',
            meta: {
                imageCount: 0,
                validImageCount: 0,
                labelCount: 0,
                isVideoProject: false,
                hasRecoverableProject: false,
                lastModified: 10,
            },
        };
        const cameraProject: StoredProjectData = {
            ...project(),
            id: location.projectId,
            workspaceId: location.workspaceId,
            lastModified: 10,
            queueItems: [{
                id: 'camera-resource-1',
                name: 'North gate',
                type: QueueItemType.CAMERA,
                status: QueueItemStatus.COMPLETED,
                uploadedAt: 1,
                cameraResourceId: 'resource-1',
                cameraChannelId: '101',
            }],
            activeQueueItemId: 'camera-resource-1',
        };
        setDatabase();
        IndexedDBManager['workspaceId'] = 'tab-camera';
        mockMethod('resolveProjectLocation').mockResolvedValue(location);
        const readProject = mockMethod('readProjectById')
            .mockResolvedValue(cameraProject);

        await expect(IndexedDBManager.getProjectMeta()).resolves.toEqual(expect.objectContaining({
            imageCount: 0,
            validImageCount: 0,
            hasRecoverableProject: true,
            lastModified: 10,
        }));
        expect(readProject).toHaveBeenCalledWith(location.projectId);
    });

    it('rejects when the pinned workspace row advances before confirmation', async () => {
        const pinnedLocation = {
            projectId: 'workspace:tab-a',
            workspaceId: 'tab-a',
            meta: {
                imageCount: 1,
                validImageCount: 1,
                labelCount: 0,
                isVideoProject: false,
                hasRecoverableProject: true,
                lastModified: 10,
            },
        };
        setDatabase();
        IndexedDBManager['workspaceId'] = 'tab-local';
        mockMethod('resolveProjectLocation')
            .mockResolvedValue(pinnedLocation);
        mockMethod('readProjectById').mockResolvedValue({
            ...project(),
            id: pinnedLocation.projectId,
            workspaceId: pinnedLocation.workspaceId,
            lastModified: 11,
        });

        await IndexedDBManager.getProjectMeta();

        await expect(IndexedDBManager.loadProject())
            .rejects.toBeInstanceOf(RecoverySnapshotChangedError);
    });

    it('rejects instead of selecting another project when the pinned row disappears', async () => {
        const pinnedLocation = {
            projectId: 'workspace:tab-a',
            workspaceId: 'tab-a',
            meta: {
                imageCount: 1,
                validImageCount: 1,
                labelCount: 0,
                isVideoProject: false,
                hasRecoverableProject: true,
                lastModified: 10,
            },
        };
        setDatabase();
        IndexedDBManager['workspaceId'] = 'tab-local';
        const resolveLocation = mockMethod('resolveProjectLocation')
            .mockResolvedValue(pinnedLocation);
        mockMethod('readProjectById').mockResolvedValue(null);

        await IndexedDBManager.getProjectMeta();

        await expect(IndexedDBManager.loadProject())
            .rejects.toBeInstanceOf(RecoverySnapshotUnavailableError);
        expect(resolveLocation).toHaveBeenCalledTimes(1);
    });

    it('treats annotated zero-byte video frames as recoverable metadata', async () => {
        const videoProject: StoredProjectData = {
            ...project(),
            isVideoProject: true,
            images: [{
                id: 'frame-0',
                frameIndex: 0,
                isPlaceholder: true,
                fileName: 'frame_000000.jpg',
                fileType: 'image/jpeg',
                fileData: new ArrayBuffer(0),
                loadStatus: false,
                labelRects: [rectangle('r1')],
                labelPoints: [],
                labelLines: [],
                labelPolygons: [],
                labelNameIds: ['steel'],
            }],
        };
        setDatabase();
        IndexedDBManager['workspaceId'] = 'tab-video';
        const buildMeta = IndexedDBManager['buildMeta'].bind(IndexedDBManager);
        const meta = buildMeta(videoProject, 'tab-video', 'workspace:tab-video', 10);
        mockMethod('resolveProjectLocation').mockResolvedValue({
            projectId: 'workspace:tab-video',
            workspaceId: 'tab-video',
            meta,
        });

        await expect(IndexedDBManager.hasStoredProject()).resolves.toBe(true);
        await expect(IndexedDBManager.getProjectMeta()).resolves.toEqual(expect.objectContaining({
            validImageCount: 1,
            labelCount: 1,
            hasRecoverableProject: true,
        }));
    });

    it('counts a source-backed empty video timeline from extraction metadata', () => {
        const videoProject: StoredProjectData = {
            ...project(),
            isVideoProject: true,
            images: [],
            videoRecovery: {
                mode: 'on-demand',
                sourceQueueItemId: 'active-video',
                sourceFile: new File(['video-bytes'], 'source.mp4', {type: 'video/mp4'}),
                metadata: {
                    fps: 25,
                    duration: 4,
                    totalFrames: 100,
                    width: 1920,
                    height: 1080,
                },
            },
        };

        const meta = IndexedDBManager['buildMeta'](
            videoProject,
            'tab-video',
            'workspace:tab-video',
            10,
        );

        expect(meta).toEqual(expect.objectContaining({
            imageCount: 100,
            validImageCount: 100,
            hasRecoverableProject: true,
        }));

        videoProject.images = [{
            id: 'cached-frame',
            frameIndex: 0,
            isPlaceholder: true,
            fileName: 'frame_000000.jpg',
            fileData: new ArrayBuffer(0),
            fileType: 'image/jpeg',
            loadStatus: false,
            labelRects: [],
            labelPoints: [],
            labelLines: [],
            labelPolygons: [],
            labelNameIds: [],
        }];
        const partialMeta = IndexedDBManager['buildMeta'](
            videoProject,
            'tab-video',
            'workspace:tab-video',
            11,
        );
        expect(partialMeta).toEqual(expect.objectContaining({
            imageCount: 100,
            validImageCount: 100,
        }));
    });

    it('counts recoverable inactive queue annotations even when the active image list is empty', () => {
        const queueProject: StoredProjectData = {
            ...project(),
            queueItems: [{
                id: 'inactive-image',
                name: 'inactive.jpg',
                type: QueueItemType.IMAGE,
                file: new File(['pixels'], 'inactive.jpg', {type: 'image/jpeg'}),
                status: QueueItemStatus.COMPLETED,
                uploadedAt: 1,
            }],
            queueAnnotationSnapshots: [{
                queueItemId: 'inactive-image',
                frames: [{
                    id: 'inactive-frame',
                    frameIndex: 0,
                    fileName: 'inactive.jpg',
                    fileType: 'image/jpeg',
                    loadStatus: true,
                    labelRects: [rectangle('rect-1')],
                    labelPoints: [],
                    labelLines: [],
                    labelPolygons: [],
                    labelNameIds: ['steel'],
                }],
            }],
        };

        const meta = IndexedDBManager['buildMeta'](
            queueProject,
            'tab-queue',
            'workspace:tab-queue',
            10,
        );

        expect(meta).toEqual(expect.objectContaining({
            imageCount: 1,
            validImageCount: 1,
            labelCount: 1,
            hasRecoverableProject: true,
        }));
    });

    it('treats a saved camera queue as recoverable without image bytes', () => {
        const cameraProject: StoredProjectData = {
            ...project(),
            images: [],
            queueItems: [{
                id: 'camera-resource-1',
                name: 'North gate',
                type: QueueItemType.CAMERA,
                status: QueueItemStatus.COMPLETED,
                uploadedAt: 1,
                cameraResourceId: 'resource-1',
                cameraChannelId: '101',
                cameraHost: '192.168.10.12',
            }],
            activeQueueItemId: 'camera-resource-1',
        };

        const meta = IndexedDBManager['buildMeta'](
            cameraProject,
            'tab-camera',
            'workspace:tab-camera',
            10,
        );

        expect(meta).toEqual(expect.objectContaining({
            imageCount: 0,
            validImageCount: 0,
            hasRecoverableProject: true,
        }));
    });
});
