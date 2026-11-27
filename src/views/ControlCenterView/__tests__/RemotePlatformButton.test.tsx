import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {ComputeClusterNode, ComputeClusterService} from '../../../services/ComputeClusterService';
import {RemotePlatformButton} from '../RemotePlatformButton';

const node = {
    node_id: 'main-1',
    role: 'main',
    capabilities: ['platform.host.v1'],
    network: {ssh_available: true},
} as ComputeClusterNode;
const url = `http://platform-${'a'.repeat(24)}.localhost:12345/_opensight/open?ticket=${'b'.repeat(43)}`;
const storageKey = 'opensight.remote-platform:http://localhost/extension_service:main-1';

beforeEach(() => {
    window.localStorage.clear();
    jest.spyOn(ComputeClusterService, 'openPlatform').mockResolvedValue({url, expires_in: 7200});
});
afterEach(() => jest.restoreAllMocks());

it('hides the address editor without preparing a background proxy', () => {
    const start = jest.spyOn(ComputeClusterService, 'openPlatform');
    render(<RemotePlatformButton node={node} zh hideAddressEditor/>);
    expect(screen.getByRole('button', {name: '打开远程平台'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: '修改'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
});

it('opens a fresh proxy while preserving the saved address when the editor is hidden', async () => {
    const oldAddress = 'http://platform-6802742823f961eb569f3adc.localhost:51805/';
    window.localStorage.setItem(storageKey, oldAddress);
    const start = jest.spyOn(ComputeClusterService, 'openPlatform');
    const tab = {closed: false, location: {replace: jest.fn()}};
    jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    render(<RemotePlatformButton node={node} zh hideAddressEditor/>);
    fireEvent.click(screen.getByRole('button', {name: '打开远程平台'}));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(url));
    expect(window.localStorage.getItem(storageKey)).toBe(oldAddress);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(node.node_id);
});

it('disables the hidden-editor open action when SSH is unavailable, even with a saved address', () => {
    window.localStorage.setItem(storageKey, 'https://fixed.example/');
    const start = jest.spyOn(ComputeClusterService, 'openPlatform');
    render(<RemotePlatformButton node={{...node, network: {...node.network, ssh_available: false}}} zh hideAddressEditor/>);
    expect(screen.getByRole('button', {name: '打开远程平台'})).toBeDisabled();
    expect(start).not.toHaveBeenCalled();
});

it('does not turn the edit-click target into a submit button', async () => {
    render(<RemotePlatformButton node={node} zh/>);
    const address = `${new URL(url).origin}/`;
    await screen.findByRole('link', {name: address});
    const edit = screen.getByRole('button', {name: '修改'});
    fireEvent.click(edit);
    expect(edit).toHaveAttribute('type', 'button');
    expect(screen.getByRole('textbox', {name: '远程面板地址'})).toHaveValue(address);
    expect(screen.getByRole('button', {name: '保存'})).toBeInTheDocument();
    expect(window.localStorage.getItem(storageKey)).toBeNull();
});

it('opens an isolated tab after the proxy is ready, without an opener', async () => {
    const tab = {opener: window, closed: false, close: jest.fn(), location: {replace: jest.fn()}};
    jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const start = jest.spyOn(ComputeClusterService, 'openPlatform').mockResolvedValue({url, expires_in: 7200});
    render(<RemotePlatformButton node={node} zh/>);
    fireEvent.click(screen.getByRole('button', {name: '打开远程平台'}));
    expect(tab.opener).toBeNull();
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(url));
    expect(start).toHaveBeenCalledWith('main-1');
});

it('reports failure and closes the blank tab', async () => {
    const tab = {opener: window, close: jest.fn()};
    jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    jest.spyOn(ComputeClusterService, 'openPlatform').mockRejectedValue(new Error('offline'));
    render(<RemotePlatformButton node={node} zh/>);
    fireEvent.click(screen.getByRole('button', {name: '打开远程平台'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(tab.close).toHaveBeenCalled();
});

it('does not create another proxy when pop-ups are blocked', async () => {
    jest.spyOn(window, 'open').mockReturnValue(null);
    const start = jest.spyOn(ComputeClusterService, 'openPlatform');
    render(<RemotePlatformButton node={node} zh/>);
    fireEvent.click(screen.getByRole('button', {name: '打开远程平台'}));
    expect(screen.getByRole('alert')).toHaveTextContent('请允许打开新标签页');
    await screen.findByRole('link');
    expect(start).toHaveBeenCalledTimes(1);
});

it('hides ordinary and platform-less nodes, and disables unreachable Mains', () => {
    const {rerender} = render(<RemotePlatformButton node={{...node, role: 'node'}} zh/>);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<RemotePlatformButton node={{...node, capabilities: []}} zh/>);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<RemotePlatformButton node={{...node, network: {...node.network, ssh_available: false}}} zh/>);
    expect(screen.getByRole('button', {name: '打开远程平台'})).toBeDisabled();
    expect(screen.getByRole('button', {name: '修改'})).toBeEnabled();
});

it('shows the prepared address directly and reuses it for the first click without exposing its ticket', async () => {
    const tab = {closed: false, location: {replace: jest.fn()}};
    jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const next = url.replace('12345', '23456');
    const start = jest.spyOn(ComputeClusterService, 'openPlatform')
        .mockResolvedValueOnce({url, expires_in: 7200})
        .mockResolvedValueOnce({url: next, expires_in: 7200});
    render(<RemotePlatformButton node={node} zh/>);
    const address = `${new URL(url).origin}/`;
    const link = await screen.findByRole('link', {name: address});
    expect(link).toHaveAttribute('href', address);
    expect(start).toHaveBeenCalledTimes(1);
    expect(window.open).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('远程面板：');
    expect(document.body).not.toHaveTextContent('自动生成');
    expect(screen.getByRole('button', {name: '修改'})).toHaveTextContent('');
    expect(screen.getByRole('button', {name: '修改'}).querySelector('svg')).not.toBeNull();
    expect(document.body).not.toHaveTextContent('ticket=');
    expect(window.localStorage.length).toBe(0);
    fireEvent.click(link);
    await waitFor(() => expect(tab.location.replace).toHaveBeenLastCalledWith(url));
    expect(start).toHaveBeenCalledTimes(1);
    fireEvent.click(link);
    await waitFor(() => expect(tab.location.replace).toHaveBeenLastCalledWith(next));
    expect(start).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link')).toHaveTextContent(`${new URL(next).origin}/`);
});

it('persists a custom URL per node and opens it even when SSH is unavailable', () => {
    const tab = {closed: false, location: {replace: jest.fn()}};
    jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const start = jest.spyOn(ComputeClusterService, 'openPlatform');
    const offline = {...node, network: {ssh_available: false}} as ComputeClusterNode;
    const {rerender} = render(<RemotePlatformButton key={node.node_id} node={offline} zh/>);
    fireEvent.click(screen.getByRole('button', {name: '修改'}));
    fireEvent.change(screen.getByRole('textbox', {name: '远程面板地址'}), {target: {value: ' https://panel.example:8443/path?q=1 '}});
    fireEvent.click(screen.getByRole('button', {name: '保存'}));
    expect(window.localStorage.getItem(storageKey)).toBe('https://panel.example:8443/path?q=1');
    rerender(<RemotePlatformButton key='other' node={{...offline, node_id: 'other'}} zh/>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    rerender(<RemotePlatformButton key={node.node_id} node={offline} zh/>);
    fireEvent.click(screen.getByRole('link'));
    expect(tab.location.replace).toHaveBeenCalledWith('https://panel.example:8443/path?q=1');
    expect(start).not.toHaveBeenCalled();
});

it('clears a fixed URL and restores a fresh automatic connection', async () => {
    window.localStorage.setItem(storageKey, 'https://panel.example/');
    const tab = {closed: false, location: {replace: jest.fn()}};
    jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const start = jest.spyOn(ComputeClusterService, 'openPlatform').mockResolvedValue({url, expires_in: 7200});
    render(<RemotePlatformButton node={node} zh/>);
    fireEvent.click(screen.getByRole('button', {name: '修改'}));
    fireEvent.change(screen.getByRole('textbox'), {target: {value: '  '}});
    fireEvent.submit(screen.getByRole('form', {name: '远程面板设置'}));
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    await screen.findByRole('link', {name: `${new URL(url).origin}/`});
    fireEvent.click(screen.getByRole('button', {name: '打开远程平台'}));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(url));
    expect(start).toHaveBeenCalledWith('main-1');
    expect(start).toHaveBeenCalledTimes(1);
});

it('keeps an in-flight preparation when the user opens the platform immediately', async () => {
    let resolve: (value: {url: string; expires_in: number}) => void;
    const start = jest.spyOn(ComputeClusterService, 'openPlatform').mockReturnValue(
        new Promise(done => { resolve = done; }),
    );
    const tab = {closed: false, document: document.implementation.createHTMLDocument(), location: {replace: jest.fn()}};
    jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    render(<RemotePlatformButton node={node} zh/>);
    fireEvent.click(screen.getByRole('button', {name: '打开远程平台'}));
    expect(tab.document.body.textContent).toBe('正在验证登录…');
    expect(tab.document.body.style.display).toBe('grid');
    expect(tab.document.body.style.placeItems).toBe('center');
    expect(tab.document.title).toBe('OpenSight Platform');
    expect(start).toHaveBeenCalledTimes(1);
    resolve({url, expires_in: 7200});
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(url));
});

it('prepares only one proxy under StrictMode effect replay', async () => {
    const start = jest.spyOn(ComputeClusterService, 'openPlatform');
    render(<React.StrictMode><RemotePlatformButton node={node} zh/></React.StrictMode>);
    await screen.findByRole('link');
    expect(start).toHaveBeenCalledTimes(1);
});

it('keeps a newly saved fixed address when an older preparation finishes', async () => {
    let resolve: (value: {url: string; expires_in: number}) => void;
    jest.spyOn(ComputeClusterService, 'openPlatform').mockReturnValue(
        new Promise(done => { resolve = done; }),
    );
    render(<RemotePlatformButton node={node} zh/>);
    fireEvent.click(screen.getByRole('button', {name: '修改'}));
    fireEvent.change(screen.getByRole('textbox'), {target: {value: 'https://fixed.example/'}});
    fireEvent.click(screen.getByRole('button', {name: '保存'}));
    expect(screen.getByRole('button', {name: '打开远程平台'})).toHaveAttribute('aria-busy', 'false');
    resolve({url, expires_in: 7200});
    await waitFor(() => expect(screen.getByRole('link')).toHaveTextContent('https://fixed.example/'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('retries preparation after a failure', async () => {
    const start = jest.spyOn(ComputeClusterService, 'openPlatform')
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce({url, expires_in: 7200});
    const tab = {closed: false, location: {replace: jest.fn()}};
    jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    render(<RemotePlatformButton node={node} zh/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(screen.getByRole('button', {name: '修改'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button', {name: '打开远程平台'}));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(url));
    expect(start).toHaveBeenCalledTimes(2);
});

it('renews a prepared address after the bootstrap ticket expires', async () => {
    const next = url.replace('12345', '23456');
    const start = jest.spyOn(ComputeClusterService, 'openPlatform')
        .mockResolvedValueOnce({url, expires_in: 7200})
        .mockResolvedValueOnce({url: next, expires_in: 7200});
    const tab = {closed: false, location: {replace: jest.fn()}};
    jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    render(<RemotePlatformButton node={node} zh/>);
    const link = await screen.findByRole('link');
    const later = Date.now() + 61 * 1000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    fireEvent.click(link);
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(next));
    expect(start).toHaveBeenCalledTimes(2);
});

it.each(['javascript:alert(1)', '/relative', 'https://user:secret@panel.example/', url])(
    'rejects unsafe, incomplete, or ticket-bearing saved addresses: %s', value => {
        render(<RemotePlatformButton node={node} zh/>);
        fireEvent.click(screen.getByRole('button', {name: '修改'}));
        fireEvent.change(screen.getByRole('textbox'), {target: {value}});
        fireEvent.click(screen.getByRole('button', {name: '保存'}));
        expect(screen.getByRole('alert')).toHaveTextContent('请输入完整');
        expect(window.localStorage.getItem(storageKey)).toBeNull();
        expect(screen.getByRole('textbox')).toBeInTheDocument();
    },
);

it('keeps the current address when persistence fails', () => {
    window.localStorage.setItem(storageKey, 'https://panel.example/');
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    render(<RemotePlatformButton node={node} zh/>);
    fireEvent.click(screen.getByRole('button', {name: '修改'}));
    fireEvent.change(screen.getByRole('textbox'), {target: {value: 'https://new.example/'}});
    fireEvent.click(screen.getByRole('button', {name: '保存'}));
    expect(screen.getByRole('alert')).toHaveTextContent('地址保存失败');
    expect(window.localStorage.getItem(storageKey)).toBe('https://panel.example/');
});
