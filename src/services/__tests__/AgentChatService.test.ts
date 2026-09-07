import {GeneralSelector} from '../../store/selectors/GeneralSelector';
import {AgentChatService} from '../AgentChatService';

it('sends the signed-in cookie and active project scope to Agent routes', async () => {
    jest.spyOn(GeneralSelector, 'getProjectName').mockReturnValue('project-a');
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({tasks: [], total: 0}),
    });

    await AgentChatService.tasks();

    expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/extensions/llm-control/tasks'),
        expect.objectContaining({
            credentials: 'same-origin',
            headers: expect.objectContaining({'X-OpenSight-Project': 'project-a'}),
        }),
    );
});
