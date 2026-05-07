let pendingFiles: File[] | null = null;

export const PendingImportFiles = {
    set: (files: File[]) => { pendingFiles = files; },
    take: (): File[] | null => { const f = pendingFiles; pendingFiles = null; return f; },
};
