import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {AccountCenter} from '../AccountCenter';
import {AccountUser, accountAudit, accountSessions, accountUsers, changeAccountPassword,
    createMemberAccount, revokeOtherAccountSessions, updateAccountProfile,
    updateMemberAccount, uploadAccountAvatar} from '../../../services/AccountService';

jest.mock('../../../services/AccountService', () => ({
    accountAudit: jest.fn(), accountSessions: jest.fn(), changeAccountPassword: jest.fn(),
    accountUsers: jest.fn(), createMemberAccount: jest.fn(), updateMemberAccount: jest.fn(),
    revokeOtherAccountSessions: jest.fn(), updateAccountProfile: jest.fn(), uploadAccountAvatar: jest.fn(),
}));

const user: AccountUser = {account_id: 'account-1', username: 'admin', display_name: 'Admin', role: 'admin',
    enabled: true, password_change_required: true, avatar_url: null, permissions: ['node.upgrade'],
    scopes: {groups: ['*'], nodes: ['*'], projects: ['*']},
    approval: {user_id: 'account-1', user_name: 'Admin', user_public_key: 'public-key'}};

beforeEach(() => {
    jest.resetAllMocks();
    (accountSessions as jest.Mock).mockResolvedValue({sessions: [{current: false, created_at: 1,
        expires_at: 2000000000, last_seen_at: 2, client_label: 'Browser'}]});
    (accountAudit as jest.Mock).mockResolvedValue({events: []});
    (accountUsers as jest.Mock).mockResolvedValue({users: [user]});
});

it('hides from the backdrop without losing form content', async () => {
    const onClose = jest.fn();
    const {container, rerender} = render(
        <AccountCenter user={user} zh={false} open onClose={onClose} onUserChanged={jest.fn()}/>,
    );
    await screen.findByText('Browser');
    fireEvent.change(screen.getByLabelText('Display name'), {target: {value: 'Unsaved name'}});

    fireEvent.mouseDown(screen.getByRole('dialog', {name: 'Account center'}));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(container.querySelector('.AccountCenterBackdrop') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<AccountCenter user={user} zh={false} open={false} onClose={onClose} onUserChanged={jest.fn()}/>);
    expect(container.querySelector('.AccountCenterBackdrop')).toHaveAttribute('hidden');
    expect(screen.getByLabelText('Display name')).toHaveValue('Unsaved name');

    rerender(<AccountCenter user={user} zh={false} open onClose={onClose} onUserChanged={jest.fn()}/>);
    fireEvent.keyDown(window, {key: 'Escape'});
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', {name: 'Close account center'})).not.toBeInTheDocument();
});

it('uploads the hero avatar and updates the account', async () => {
    const onUserChanged = jest.fn();
    const updated = {...user, avatar_url: '/avatar.png'};
    (uploadAccountAvatar as jest.Mock).mockResolvedValue(updated);
    render(<AccountCenter user={user} zh={false} onClose={jest.fn()} onUserChanged={onUserChanged}/>);
    const file = new File(['avatar'], 'avatar.png', {type: 'image/png'});
    fireEvent.change(screen.getByLabelText('Change avatar'), {target: {files: [file]}});
    await screen.findByText('Avatar updated');
    expect(uploadAccountAvatar).toHaveBeenCalledWith(file);
    expect(onUserChanged).toHaveBeenCalledWith(updated);
});

it('saves the profile and refreshes account activity', async () => {
    const onUserChanged = jest.fn();
    const updated = {...user, display_name: 'Updated'};
    (updateAccountProfile as jest.Mock).mockResolvedValue(updated);
    render(<AccountCenter user={user} zh={false} onClose={jest.fn()} onUserChanged={onUserChanged}/>);
    await screen.findByText('Browser');
    expect(screen.getByText('Save changes')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Display name'), {target: {value: 'Other'}});
    expect(screen.getByText('Save changes')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Display name'), {target: {value: 'Admin'}});
    expect(screen.getByText('Save changes')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Display name'), {target: {value: ' Admin '}});
    expect(screen.getByText('Save changes')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Display name'), {target: {value: ' '}});
    expect(screen.getByText('Save changes')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Display name'), {target: {value: 'Updated'}});
    fireEvent.click(screen.getByText('Save changes'));
    await screen.findByText('Profile saved');
    expect(updateAccountProfile).toHaveBeenCalledWith('Updated');
    expect(screen.getByText('Save changes')).toBeDisabled();
    expect(onUserChanged).toHaveBeenCalledWith(updated);
});

it('requires matching passwords and clears inputs after success', async () => {
    (changeAccountPassword as jest.Mock).mockResolvedValue(undefined);
    render(<AccountCenter user={user} zh={false} onClose={jest.fn()} onUserChanged={jest.fn()}/>);
    await screen.findByText('Browser');
    const button = screen.getByText('Change password');
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Current password'), {target: {value: 'old-password'}});
    fireEvent.change(screen.getByLabelText('New password (10+ characters)'), {target: {value: 'new-password'}});
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confirm password'), {target: {value: 'new-password'}});
    fireEvent.click(button);
    await screen.findByText('Password changed; other sessions signed out');
    expect(changeAccountPassword).toHaveBeenCalledWith('old-password', 'new-password');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
});

it('reports failed saves and allows retry', async () => {
    (updateAccountProfile as jest.Mock).mockRejectedValue(new Error('Unavailable'));
    render(<AccountCenter user={user} zh={false} onClose={jest.fn()} onUserChanged={jest.fn()}/>);
    await screen.findByText('Browser');
    fireEvent.change(screen.getByLabelText('Display name'), {target: {value: 'Changed'}});
    fireEvent.click(screen.getByText('Save changes'));
    await screen.findByText('Unavailable');
    expect(screen.getByText('Save changes')).toBeEnabled();
});

it('revokes other sessions and reloads the device list', async () => {
    (revokeOtherAccountSessions as jest.Mock).mockResolvedValue({revoked: 1});
    render(<AccountCenter user={user} zh={false} onClose={jest.fn()} onUserChanged={jest.fn()}/>);
    fireEvent.click(await screen.findByText('Sign out other devices'));
    await screen.findByText('Signed out 1 other session(s)');
    await waitFor(() => expect(accountSessions).toHaveBeenCalledTimes(2));
});

it('generates passwords directly without a dropdown or replacing the current password', async () => {
    render(<AccountCenter user={user} zh={false} onClose={jest.fn()} onUserChanged={jest.fn()}/>);
    await screen.findByText('Browser');
    fireEvent.change(screen.getByLabelText('Current password'), {target: {value: 'existing-password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Generate password'}));
    const first = (screen.getByLabelText('New password (10+ characters)') as HTMLInputElement).value;
    expect(first).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(screen.getByLabelText('Current password')).toHaveValue('existing-password');
    expect(screen.getByLabelText('Confirm password')).toHaveValue(first);
    expect(changeAccountPassword).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Generate password'}));
    const second = (screen.getByLabelText('New password (10+ characters)') as HTMLInputElement).value;
    expect(second).not.toBe(first);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toHaveValue(second);
    fireEvent.click(screen.getByRole('button', {name: 'Show passwords'}));
    expect(screen.getByLabelText('Current password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('New password (10+ characters)')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', {name: 'Hide passwords'}));
    expect(screen.getByLabelText('Current password')).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', {name: 'Change password'}));
    await screen.findByText('Password changed; other sessions signed out');
    expect(changeAccountPassword).toHaveBeenCalledWith('existing-password', second);
    expect(screen.queryByRole('option', {name: /Generated password/})).not.toBeInTheDocument();
    expect(screen.getByLabelText('New password (10+ characters)')).toHaveValue('');
});

it('clears generated candidates on close and allows manual password entry', async () => {
    const props = {user, zh: false, onClose: jest.fn(), onUserChanged: jest.fn()};
    const {unmount} = render(<AccountCenter {...props}/>);
    await screen.findByText('Browser');
    fireEvent.click(screen.getByRole('button', {name: 'Generate password'}));
    fireEvent.change(screen.getByLabelText('New password (10+ characters)'), {target: {value: 'manual-password'}});
    expect(screen.getByLabelText('New password (10+ characters)')).toHaveValue('manual-password');
    unmount();
    render(<AccountCenter {...props}/>);
    await screen.findByText('Browser');
    expect(screen.queryByRole('option', {name: /Generated password/})).not.toBeInTheDocument();
    expect(screen.getByLabelText('New password (10+ characters)')).toHaveValue('');
});

it('creates and permanently disables a scoped member', async () => {
    const administrator = {...user, password_change_required: false};
    const member: AccountUser = {
        ...administrator,
        account_id: 'member-1', username: 'member.one', display_name: 'Member One', role: 'member',
        password_change_required: true, permissions: ['cluster.read', 'agent.use'],
        scopes: {groups: ['group-a'], nodes: ['node-a'], projects: ['project-a']},
    };
    (accountUsers as jest.Mock)
        .mockResolvedValueOnce({users: [administrator]})
        .mockResolvedValue({users: [administrator, member]});
    (createMemberAccount as jest.Mock).mockResolvedValue({user: member});
    (updateMemberAccount as jest.Mock).mockResolvedValue({user: {...member, enabled: false}});
    render(<AccountCenter user={administrator} zh={false} onClose={jest.fn()} onUserChanged={jest.fn()}/>);

    await screen.findByText('Browser');
    fireEvent.change(screen.getAllByLabelText('Username')[1], {target: {value: 'member.one'}});
    fireEvent.change(screen.getAllByLabelText('Display name')[1], {target: {value: 'Member One'}});
    fireEvent.change(screen.getByLabelText('Initial password (10+ characters)'), {target: {value: 'member-password'}});
    fireEvent.change(screen.getByLabelText('Group scopes (comma separated)'), {target: {value: 'group-a'}});
    fireEvent.change(screen.getByLabelText('Node scopes (comma separated)'), {target: {value: 'node-a'}});
    fireEvent.change(screen.getByLabelText('Project scopes (comma separated)'), {target: {value: 'project-a'}});
    fireEvent.click(screen.getByText('Create member'));
    await screen.findByText('Member created');
    expect(createMemberAccount).toHaveBeenCalledWith({
        username: 'member.one', display_name: 'Member One', initial_password: 'member-password',
        permissions: ['cluster.read', 'agent.use'],
        scopes: {groups: ['group-a'], nodes: ['node-a'], projects: ['project-a']},
    });

    fireEvent.change(screen.getByLabelText('Member account'), {target: {value: 'member-1'}});
    fireEvent.click(screen.getByText('Disable permanently'));
    await screen.findByText('Member permanently disabled');
    expect(updateMemberAccount).toHaveBeenCalledWith('member-1', {
        enabled: false,
        permissions: ['cluster.read', 'agent.use'],
        scopes: {groups: ['group-a'], nodes: ['node-a'], projects: ['project-a']},
    });
});
