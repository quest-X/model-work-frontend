import React, {useEffect, useId, useState} from 'react';
import {
    AccountUser, accountAudit, accountSessions, accountUsers, changeAccountPassword,
    createMemberAccount, revokeOtherAccountSessions, updateAccountProfile,
    updateMemberAccount, uploadAccountAvatar,
} from '../../services/AccountService';
import {useAccountApprovalIdentity} from '../../services/ApprovalIdentityService';
import {useEscapeToClose} from '../../hooks/useEscapeToClose';
import './AccountCenter.scss';

interface IProps {
    user: AccountUser;
    zh: boolean;
    open?: boolean;
    onClose: () => void;
    onUserChanged: (user: AccountUser) => void;
}

type SessionRow = {current: boolean; created_at: number; expires_at: number; last_seen_at: number; client_label: string};
type AuditRow = {action: string; detail: string; created_at: number};

const permissionNames: Record<string, [string, string]> = {
    'camera.connect': ['连接摄像头', 'Connect cameras'],
    'camera.request': ['摄像头操作', 'Camera operations'],
    'filesystem.list': ['浏览文件', 'Browse files'],
    'filesystem.stat': ['查看文件信息', 'View file information'],
    'cluster.read': ['查看节点与群', 'View nodes and groups'],
    'cluster.control': ['控制节点与任务', 'Control nodes and tasks'],
    'agent.use': ['使用 Agent', 'Use Agent'],
    'jetson.connect': ['连接边缘设备', 'Connect edge devices'],
    'node.upgrade': ['升级节点', 'Upgrade nodes'],
};
const permissionLabel = (permission: string, zh: boolean): string =>
    permissionNames[permission]?.[zh ? 0 : 1] || permission;
const csvValues = (value: string): string[] => Array.from(new Set(
    value.split(',').map(item => item.trim()).filter(Boolean),
));

// 64 symbols give each character six unbiased random bits.
const generateAccountPassword = (): string => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, value => alphabet[value & 63]).join('');
};

// This account form keeps bilingual labels and its four mutation handlers together.
// eslint-disable-next-line complexity
export const AccountCenter: React.FC<IProps> = ({user, zh, open = true, onClose, onUserChanged}) => {
    const [displayName, setDisplayName] = useState(user.display_name);
    const [savedDisplayName, setSavedDisplayName] = useState(user.display_name);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPasswords, setShowPasswords] = useState(false);
    const passwordFieldId = useId();
    const passwordInputType = showPasswords ? 'text' : 'password';
    const [sessions, setSessions] = useState<SessionRow[]>([]);
    const [events, setEvents] = useState<AuditRow[]>([]);
    const [members, setMembers] = useState<AccountUser[]>([]);
    const [selectedMemberId, setSelectedMemberId] = useState('');
    const [memberUsername, setMemberUsername] = useState('');
    const [memberDisplayName, setMemberDisplayName] = useState('');
    const [memberPassword, setMemberPassword] = useState('');
    const [memberPermissions, setMemberPermissions] = useState('cluster.read, agent.use');
    const [memberGroups, setMemberGroups] = useState('');
    const [memberNodes, setMemberNodes] = useState('');
    const [memberProjects, setMemberProjects] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEscapeToClose(onClose, open, 20);

    const reloadActivity = () => Promise.all([
        accountSessions(), accountAudit(),
        user.role === 'admin' && !user.password_change_required
            ? accountUsers() : Promise.resolve({users: []}),
    ]).then(([active, audit, managed]) => {
        setSessions(active.sessions);
        setEvents(audit.events);
        setMembers(managed.users.filter(account => account.role === 'member'));
    }).catch(reason => setError(reason instanceof Error ? reason.message : '加载账户记录失败'));

    useEffect(() => { reloadActivity(); }, [user.account_id, user.role, user.password_change_required]);
    const date = (value: number) => new Date(value * 1000).toLocaleString(zh ? 'zh-CN' : 'en-US');
    const selectMember = (accountId: string) => {
        const member = members.find(account => account.account_id === accountId);
        setSelectedMemberId(accountId);
        setMemberUsername(member?.username || '');
        setMemberDisplayName(member?.display_name || '');
        setMemberPassword('');
        setMemberPermissions(member?.permissions.join(', ') || 'cluster.read, agent.use');
        setMemberGroups(member?.scopes.groups.join(', ') || '');
        setMemberNodes(member?.scopes.nodes.join(', ') || '');
        setMemberProjects(member?.scopes.projects.join(', ') || '');
    };
    const selectedMember = members.find(account => account.account_id === selectedMemberId);
    const memberPayload = () => ({
        permissions: csvValues(memberPermissions),
        scopes: {
            groups: csvValues(memberGroups),
            nodes: csvValues(memberNodes),
            projects: csvValues(memberProjects),
        },
    });

    return <div className='AccountCenterBackdrop' role='presentation' hidden={!open}
        style={open ? undefined : {display: 'none'}} onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
    }}>
        <section className='AccountCenter' role='dialog' aria-modal='true' aria-label={zh ? '个人中心' : 'Account center'}>
            <div className='AccountCenterScroll'>
            <header>
                <div><h2>{zh ? '个人中心' : 'Account center'}</h2></div>
            </header>
            <div className='AccountCenterHero'>
                <label className='AccountCenterAvatar' title={zh ? '更换头像' : 'Change avatar'}>
                    {user.avatar_url ? <img src={user.avatar_url} alt=''/> : <span>{user.role === 'admin' ? '管' : (user.display_name[0] || 'A').toUpperCase()}</span>}
                    <input type='file' accept='image/png,image/jpeg,image/webp' disabled={busy}
                        aria-label={zh ? '更换头像' : 'Change avatar'} onChange={async event => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (!file) return;
                            setBusy(true); setError(''); setMessage('');
                            try {
                                onUserChanged(await uploadAccountAvatar(file));
                                setMessage(zh ? '头像已更新' : 'Avatar updated');
                            } catch (reason) { setError(reason instanceof Error ? reason.message : (zh ? '头像上传失败' : 'Avatar upload failed')); }
                            finally { setBusy(false); }
                        }}/>
                </label>
                <h3>{user.display_name}</h3>
                <p>{user.username}</p>
                <small className='AccountAvatarHint'>{zh ? '点击头像更换' : 'Click avatar to change'}</small>
            </div>
            {user.password_change_required && <div className='AccountCenterNotice'>
                {zh ? '首次使用请修改初始密码，修改后才可批准节点操作。' : 'Change the initial password before approving node operations.'}
            </div>}
            {(message || error) && <div className={error ? 'AccountCenterError' : 'AccountCenterSuccess'} role='status'>{error || message}</div>}
            <div className='AccountCenterGrid'>
                <article>
                    <h3>{zh ? '个人资料' : 'Profile'}</h3>
                    <label>{zh ? '账号' : 'Username'}<input value={user.username} disabled/></label>
                    <label>{zh ? '角色' : 'Role'}<input value={user.role === 'admin' ? (zh ? '管理员' : 'Administrator') : (zh ? '成员' : 'Member')} disabled/></label>
                    <label>{zh ? '显示名称' : 'Display name'}<input value={displayName} disabled={busy} maxLength={128} onChange={event => setDisplayName(event.target.value)}/></label>
                    <button type='button' disabled={busy || !displayName.trim() || displayName.trim() === savedDisplayName.trim()} onClick={async () => {
                        setBusy(true); setError(''); setMessage('');
                        try {
                            const updated = await updateAccountProfile(displayName.trim());
                            useAccountApprovalIdentity(updated.approval);
                            onUserChanged(updated);
                            setSavedDisplayName(updated.display_name);
                            setDisplayName(updated.display_name);
                            setMessage(zh ? '个人资料已保存' : 'Profile saved');
                            await reloadActivity();
                        } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
                        finally { setBusy(false); }
                    }}>{zh ? '保存变更' : 'Save changes'}</button>
                </article>
                <article>
                    <h3>{zh ? '账户安全' : 'Account security'}</h3>
                    <label htmlFor={`${passwordFieldId}-current`}>{zh ? '当前密码' : 'Current password'}</label>
                    <div className='AccountPasswordRow'>
                        <input id={`${passwordFieldId}-current`} type={passwordInputType} autoComplete='current-password'
                            value={currentPassword} disabled={busy} onChange={event => setCurrentPassword(event.target.value)}/>
                        <div className='AccountPasswordActions'>
                            <button type='button' title={zh ? '随机生成密码' : 'Generate password'}
                                aria-label={zh ? '随机生成密码' : 'Generate password'} disabled={busy} onClick={() => {
                                try {
                                    const password = generateAccountPassword();
                                    setNewPassword(password);
                                    setConfirmPassword(password);
                                    setError('');
                                } catch {
                                    setError(zh ? '随机密码生成失败，请重试或手动输入。' : 'Could not generate a password. Retry or enter one manually.');
                                }
                            }}><svg viewBox='0 0 24 24' aria-hidden='true'><path d='m16 3 4 4-4 4M4 17h3c4 0 6-10 10-10h3M16 13l4 4-4 4M4 7h3c1 0 2 .7 3 2m4 6c1 1.3 2 2 3 2h3'/></svg></button>
                            <button type='button' title={showPasswords ? (zh ? '隐藏明文' : 'Hide passwords') : (zh ? '查看明文' : 'Show passwords')}
                                aria-label={showPasswords ? (zh ? '隐藏明文' : 'Hide passwords') : (zh ? '查看明文' : 'Show passwords')} aria-pressed={showPasswords} onClick={() => setShowPasswords(value => !value)}>
                                <svg viewBox='0 0 24 24' aria-hidden='true'><path d='M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z'/><circle cx='12' cy='12' r='3'/>{showPasswords && <path d='m3 3 18 18'/>}</svg>
                            </button>
                        </div>
                    </div>
                    <label htmlFor={`${passwordFieldId}-new`}>{zh ? '新密码（至少 10 位）' : 'New password (10+ characters)'}</label>
                    <div className='AccountNewPassword'>
                        <input id={`${passwordFieldId}-new`} type={passwordInputType} autoComplete='new-password'
                            value={newPassword} disabled={busy} onChange={event => {
                                setNewPassword(event.target.value);
                            }}/>
                    </div>
                    <label>{zh ? '确认新密码' : 'Confirm password'}<input type={passwordInputType} autoComplete='new-password' disabled={busy} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}/></label>
                    <button type='button' disabled={busy || !currentPassword || newPassword.length < 10 || newPassword !== confirmPassword} onClick={async () => {
                        setBusy(true); setError(''); setMessage('');
                        try {
                            await changeAccountPassword(currentPassword, newPassword);
                            onUserChanged({...user, password_change_required: false});
                            setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
                            setShowPasswords(false);
                            setMessage(zh ? '密码已修改，其他登录会话已退出' : 'Password changed; other sessions signed out');
                            await reloadActivity();
                        } catch (reason) { setError(reason instanceof Error ? reason.message : '修改失败'); }
                        finally { setBusy(false); }
                    }}>{zh ? '修改密码' : 'Change password'}</button>
                </article>
                <article>
                    <h3>{zh ? '我的权限' : 'My permissions'}</h3>
                    <p>{zh ? '登录后自动加载授权身份；每次敏感操作仍需点击确认。' : 'Your approval identity loads after login; sensitive actions still require confirmation.'}</p>
                    <div className='AccountPermissionList'>{user.permissions.map(permission => <span key={permission} title={permission}>{permissionLabel(permission, zh)}</span>)}</div>
                    <details className='AccountIdentityDetails'><summary>{zh ? '授权详情' : 'Authorization details'}</summary><small className='AccountIdentity'>{user.approval.user_id}</small></details>
                </article>
                <article>
                    <h3>{zh ? '登录设备' : 'Signed-in devices'}</h3>
                    <div className='AccountList'>{sessions.map((session, index) => <div key={`${session.created_at}-${index}`}>
                        <strong>{session.current ? (zh ? '当前设备' : 'Current device') : (zh ? '其他设备' : 'Other device')}</strong>
                        <span>{date(session.last_seen_at)}</span><small>{session.client_label}</small>
                    </div>)}</div>
                    {sessions.some(session => !session.current) && <button type='button' className='AccountSecondaryAction' disabled={busy} onClick={async () => {
                        setBusy(true); setError(''); setMessage('');
                        try {
                            const result = await revokeOtherAccountSessions();
                            setMessage(zh ? `已退出 ${result.revoked} 个其他登录会话` : `Signed out ${result.revoked} other session(s)`);
                            await reloadActivity();
                        } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); }
                        finally { setBusy(false); }
                    }}>{zh ? '退出其他设备' : 'Sign out other devices'}</button>}
                </article>
                {user.role === 'admin' && !user.password_change_required && <article className='AccountMembers'>
                    <h3>{zh ? '成员权限' : 'Member access'}</h3>
                    <label>{zh ? '成员账户' : 'Member account'}<select value={selectedMemberId}
                        disabled={busy} onChange={event => selectMember(event.target.value)}>
                        <option value=''>{zh ? '新建成员' : 'New member'}</option>
                        {members.map(member => <option key={member.account_id} value={member.account_id}>
                            {member.display_name} · {member.username}{member.enabled ? '' : (zh ? ' · 已停用' : ' · disabled')}
                        </option>)}
                    </select></label>
                    <div className='AccountMemberFields'>
                        <label>{zh ? '账号' : 'Username'}<input value={memberUsername} disabled={busy || Boolean(selectedMemberId)}
                            maxLength={64} onChange={event => setMemberUsername(event.target.value)}/></label>
                        <label>{zh ? '显示名称' : 'Display name'}<input value={memberDisplayName} disabled={busy || Boolean(selectedMemberId)}
                            maxLength={128} onChange={event => setMemberDisplayName(event.target.value)}/></label>
                        {!selectedMemberId && <label>{zh ? '初始密码（至少 10 位）' : 'Initial password (10+ characters)'}
                            <input type='password' autoComplete='new-password' value={memberPassword} disabled={busy}
                                onChange={event => setMemberPassword(event.target.value)}/></label>}
                        <label>{zh ? '操作权限（逗号分隔）' : 'Operations (comma separated)'}
                            <input value={memberPermissions} disabled={busy || selectedMember?.enabled === false}
                                onChange={event => setMemberPermissions(event.target.value)}/></label>
                        <label>{zh ? '群范围（逗号分隔）' : 'Group scopes (comma separated)'}
                            <input value={memberGroups} disabled={busy || selectedMember?.enabled === false}
                                onChange={event => setMemberGroups(event.target.value)}/></label>
                        <label>{zh ? '节点范围（逗号分隔）' : 'Node scopes (comma separated)'}
                            <input value={memberNodes} disabled={busy || selectedMember?.enabled === false}
                                onChange={event => setMemberNodes(event.target.value)}/></label>
                        <label>{zh ? '项目范围（逗号分隔）' : 'Project scopes (comma separated)'}
                            <input value={memberProjects} disabled={busy || selectedMember?.enabled === false}
                                onChange={event => setMemberProjects(event.target.value)}/></label>
                    </div>
                    <div className='AccountMemberActions'>
                        <button type='button' disabled={busy || !memberPermissions.trim()
                            || (selectedMemberId ? selectedMember?.enabled === false
                                : !memberUsername.trim() || !memberDisplayName.trim() || memberPassword.length < 10)}
                        onClick={async () => {
                            setBusy(true); setError(''); setMessage('');
                            try {
                                if (selectedMemberId) {
                                    await updateMemberAccount(selectedMemberId, {enabled: true, ...memberPayload()});
                                    setMessage(zh ? '成员权限已保存' : 'Member access saved');
                                } else {
                                    await createMemberAccount({
                                        username: memberUsername.trim(), display_name: memberDisplayName.trim(),
                                        initial_password: memberPassword, ...memberPayload(),
                                    });
                                    setMessage(zh ? '成员已创建' : 'Member created');
                                }
                                selectMember('');
                                await reloadActivity();
                            } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
                            finally { setBusy(false); }
                        }}>{selectedMemberId ? (zh ? '保存权限' : 'Save access') : (zh ? '创建成员' : 'Create member')}</button>
                        {selectedMember?.enabled && <button type='button' className='AccountDangerAction' disabled={busy}
                            onClick={async () => {
                                setBusy(true); setError(''); setMessage('');
                                try {
                                    await updateMemberAccount(selectedMember.account_id, {enabled: false, ...memberPayload()});
                                    setMessage(zh ? '成员已永久停用' : 'Member permanently disabled');
                                    selectMember('');
                                    await reloadActivity();
                                } catch (reason) { setError(reason instanceof Error ? reason.message : '停用失败'); }
                                finally { setBusy(false); }
                            }}>{zh ? '永久停用' : 'Disable permanently'}</button>}
                    </div>
                    <p>{zh ? '停用会撤销该身份、会话与节点信任，不能重新启用。' : 'Disabling revokes the identity, sessions, and node trust permanently.'}</p>
                </article>}
                <article className='AccountAudit'>
                    <h3>{zh ? '操作记录' : 'Activity'}</h3>
                    <div className='AccountList'>{events.map((event, index) => <div key={`${event.created_at}-${index}`}>
                        <strong>{event.action}</strong><span>{date(event.created_at)}</span><small>{event.detail}</small>
                    </div>)}</div>
                </article>
            </div>
            </div>
        </section>
    </div>;
};
