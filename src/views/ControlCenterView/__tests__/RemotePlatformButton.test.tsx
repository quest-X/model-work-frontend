import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {ComputeClusterNode, ComputeClusterService} from '../../../services/ComputeClusterService';
import {RemotePlatformButton} from '../RemotePlatformButton';

const node = {node_id: 'main-1', role: 'main', network: {ssh_available: true}} as ComputeClusterNode;
const url = `http://platform-${'a'.repeat(24)}.localhost:12345/_opensight/open?ticket=${'b'.repeat(43)}`;

afterEach(() => jest.restoreAllMocks());

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
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(tab.close).toHaveBeenCalled();
});

it('does not create a proxy when pop-ups are blocked', async () => {
    jest.spyOn(window, 'open').mockReturnValue(null);
    const start = jest.spyOn(ComputeClusterService, 'openPlatform');
    render(<RemotePlatformButton node={node} zh/>);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('alert')).toHaveTextContent('请允许打开新标签页');
    expect(start).not.toHaveBeenCalled();
});

it('hides ordinary nodes and disables unreachable Mains', () => {
    const {rerender} = render(<RemotePlatformButton node={{...node, role: 'node'}} zh/>);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<RemotePlatformButton node={{...node, network: {...node.network, ssh_available: false}}} zh/>);
    expect(screen.getByRole('button')).toBeDisabled();
});
