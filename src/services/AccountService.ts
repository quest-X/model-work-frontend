import {DEMO_SESSION_KEY, isDemoMode} from '../demo/DemoMode';

export type AccountApproval = {user_id: string; user_name: string; user_public_key: string};
export type AccountScopes = {groups: string[]; nodes: string[]; projects: string[]};
export type AccountUser = {
    account_id: string;
    username: string;
    display_name: string;
    role: 'admin' | 'member';
    enabled: boolean;
    password_change_required: boolean;
    avatar_url: string | null;
    approval: AccountApproval;
    permissions: string[];
    scopes: AccountScopes;
};
export type AccountSession = {user: AccountUser; csrf_token: string; expires_at: number};
export type MemberAccountCreate = {
    username: string;
    display_name: string;
    initial_password: string;
    permissions: string[];
    scopes: AccountScopes;
};
export type MemberAccountUpdate = Pick<AccountUser, 'enabled' | 'permissions' | 'scopes'>;

export const ACCOUNT_SESSION_CHANGED = 'opensight:account-session-changed';
let activeSession: AccountSession | null = null;
let sessionGeneration = 0;

const errorMessage = async (response: Response): Promise<string> => {
    if (response.status === 404) return '登录服务尚未就绪，请检查后台服务';
    const body = await response.json().catch(() => ({}));
    const detail = body?.detail?.message || body?.detail;
    if (detail === 'node_admission_required') return '当前机器未通过 OpenSight Master/Main 准入';
    if (response.status === 502 || response.status === 503) return '后台服务暂时不可用，请稍后重试';
    return typeof detail === 'string' ? detail : `HTTP ${response.status}`;
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`/core_service/account${path}`, {
        credentials: 'same-origin', ...init,
        headers: {
            ...(init?.body instanceof FormData ? {} : {'Content-Type': 'application/json'}),
            ...(activeSession ? {'X-CSRF-Token': activeSession.csrf_token} : {}),
            ...(init?.headers || {}),
        },
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    return response.status === 204 ? undefined as T : response.json();
};

const publish = (session: AccountSession | null): AccountSession | null => {
    activeSession = session;
    window.dispatchEvent(new Event(ACCOUNT_SESSION_CHANGED));
    return session;
};

export const currentAccountSession = (): AccountSession | null => activeSession;
export const accountCsrfToken = (): string => activeSession?.csrf_token || '';

const validateSession = (session: AccountSession): AccountSession => {
    if (!session?.user?.approval || typeof session.user.account_id !== 'string'
        || typeof session.csrf_token !== 'string' || !session.csrf_token
        || !Number.isFinite(session.expires_at)) throw new Error('Invalid account session');
    return session;
};

export const refreshAccountSession = async (): Promise<AccountSession | null> => {
    const generation = ++sessionGeneration;
    if (isDemoMode && !window.localStorage.getItem(DEMO_SESSION_KEY)) return publish(null);
    try {
        const session = validateSession(await request<AccountSession>('/session'));
        return generation === sessionGeneration ? publish(session) : activeSession;
    } catch {
        return generation === sessionGeneration ? publish(null) : activeSession;
    }
};

export const loginAccount = async (username: string, password: string, remember: boolean): Promise<AccountSession> => {
    const generation = ++sessionGeneration;
    const session = validateSession(await request<AccountSession>('/login', {
        method: 'POST', body: JSON.stringify({username, password, remember}),
    }));
    if (generation !== sessionGeneration) throw new Error('Login superseded');
    if (isDemoMode) window.localStorage.setItem(DEMO_SESSION_KEY, '1');
    publish(session);
    return session;
};

export const logoutAccount = async (): Promise<void> => {
    sessionGeneration += 1;
    if (isDemoMode) window.localStorage.removeItem(DEMO_SESSION_KEY);
    const pending = request<void>('/logout', {method: 'POST', body: '{}'});
    publish(null);
    await pending;
};

export const updateAccountProfile = async (displayName: string): Promise<AccountUser> => {
    const generation = sessionGeneration;
    const result = await request<{user: AccountUser}>('/profile', {
        method: 'PATCH', body: JSON.stringify({display_name: displayName}),
    });
    if (generation === sessionGeneration && activeSession) publish({...activeSession, user: result.user});
    return result.user;
};

export const changeAccountPassword = async (currentPassword: string, newPassword: string): Promise<void> => {
    const generation = sessionGeneration;
    await request('/password', {
        method: 'POST', body: JSON.stringify({current_password: currentPassword, new_password: newPassword}),
    });
    if (generation === sessionGeneration && activeSession) {
        publish({...activeSession, user: {...activeSession.user, password_change_required: false}});
    }
};

export const uploadAccountAvatar = async (file: File): Promise<AccountUser> => {
    const generation = sessionGeneration;
    const body = new FormData();
    body.append('avatar', file);
    const result = await request<{user: AccountUser}>('/avatar', {method: 'POST', body});
    if (generation === sessionGeneration && activeSession) publish({...activeSession, user: result.user});
    return result.user;
};

export const accountSessions = (): Promise<{sessions: Array<{
    current: boolean; created_at: number; expires_at: number; last_seen_at: number; client_label: string;
}>}> => request('/sessions');

export const revokeOtherAccountSessions = (): Promise<{revoked: number}> =>
    request('/sessions/revoke-others', {method: 'POST', body: '{}'});

export const accountAudit = (): Promise<{events: Array<{
    action: string; detail: string; created_at: number;
}>}> => request('/audit');

export const accountUsers = (): Promise<{users: AccountUser[]}> => request('/users');

export const createMemberAccount = (member: MemberAccountCreate): Promise<{user: AccountUser}> =>
    request('/users', {method: 'POST', body: JSON.stringify(member)});

export const updateMemberAccount = (
    accountId: string, member: MemberAccountUpdate,
): Promise<{user: AccountUser}> => request(`/users/${encodeURIComponent(accountId)}`, {
    method: 'PATCH', body: JSON.stringify(member),
});

export const serverSignAuthorization = (authorizationRequest: object): Promise<{signature: string}> =>
    request('/authorization/sign', {method: 'POST', body: JSON.stringify({request: authorizationRequest})});
