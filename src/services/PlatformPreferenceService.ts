import type {AccountUser} from './AccountService';
import type {PlatformMode} from '../views/EditorView/EditorView';

type PlatformAccount = Pick<AccountUser, 'account_id' | 'role'>;
const preferenceKey = (accountId: string): string => `opensight:default-platform:${accountId}`;

export const getDefaultPlatform = (user?: PlatformAccount | null): PlatformMode => {
    try {
        const stored = user?.account_id ? localStorage.getItem(preferenceKey(user.account_id)) : null;
        if (stored === 'annotation' || stored === 'control') return stored;
    } catch {
        // Storage restrictions must not prevent the workspace from opening.
    }
    return user?.role === 'admin' ? 'control' : 'annotation';
};

export const saveDefaultPlatform = (user: PlatformAccount, mode: PlatformMode): void => {
    localStorage.setItem(preferenceKey(user.account_id), mode);
};
