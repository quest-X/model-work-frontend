import {getExtensionEngineBaseUrl} from '../utils/DefaultBackendUrl';
import {GeneralSelector} from '../store/selectors/GeneralSelector';

export type AgentChatStatus = {
    status: 'ready' | 'degraded';
    auth_configured: boolean;
    llm_configured: boolean;
    primary_model: string;
};

export type AgentChatResponse = {
    conversation_id: string;
    message: string;
    model: string;
    degraded: boolean;
    tool_calls?: Array<{
        name: string;
        ok: boolean;
        result?: {
            kind?: string;
            node_name?: string;
        };
    }>;
};

export type AgentChatEvent =
    | {type: 'status'; phase: 'preparing' | 'model' | 'tool'}
    | {type: 'delta'; content: string};

export type AgentTraceTask = {
    id: string;
    kind: string;
    title: string;
    status: 'draft' | 'ready' | 'queued' | 'running' | 'succeeded' | 'completed' | 'failed' | 'cancelled';
    revision: number;
    source_message: string | null;
    result: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
};

export type AgentTraceTaskList = {
    tasks: AgentTraceTask[];
    total: number;
};

export type AgentConversation = {
    id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
};

export type AgentConversationMessage = {
    id: string;
    conversation_id: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    metadata: Record<string, unknown>;
    created_at: string;
};

export type AgentConversationDetail = {
    conversation: AgentConversation;
    messages: AgentConversationMessage[];
};

const baseUrl = (): string => `${getExtensionEngineBaseUrl()}/extensions/llm-control`;

const fetchResponse = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await fetch(`${baseUrl()}${path}`, {
        credentials: 'same-origin',
        ...init,
        headers: {
            ...(init?.body ? {'Content-Type': 'application/json'} : {}),
            'X-OpenSight-Project': GeneralSelector.getProjectName().trim() || 'default-project',
            ...(init?.headers || {}),
        },
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`);
    }
    return response;
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> =>
    (await fetchResponse(path, init)).json();

export class AgentChatService {
    public static status(): Promise<AgentChatStatus> {
        return request('/status');
    }

    public static async send(
        message: string,
        conversationId?: string,
        taskId?: string,
        onEvent?: (event: AgentChatEvent) => void,
    ): Promise<AgentChatResponse> {
        const response = await fetchResponse('/chat', {
            method: 'POST',
            headers: onEvent ? {Accept: 'application/x-ndjson'} : {},
            body: JSON.stringify({
                message,
                ...(conversationId ? {conversation_id: conversationId} : {}),
                ...(taskId ? {task_id: taskId} : {}),
            }),
        });
        if (!response.headers.get('content-type')?.includes('application/x-ndjson')) return response.json();
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Agent response stream is unavailable');
        const decoder = new TextDecoder();
        let buffer = '';
        const consume = (line: string): AgentChatResponse | undefined => {
            if (!line.trim()) return undefined;
            const event = JSON.parse(line);
            if (event.type === 'error') throw new Error(event.detail || 'Agent response failed');
            if (event.type === 'done') {
                if (typeof event.response?.message !== 'string' || !event.response.conversation_id) {
                    throw new Error('Invalid Agent response');
                }
                return event.response;
            }
            if (event.type === 'status' || event.type === 'delta') onEvent?.(event);
            return undefined;
        };
        try {
            for (;;) {
                const {done, value} = await reader.read();
                buffer += decoder.decode(value, {stream: !done});
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const result = consume(line);
                    if (result) return result;
                }
                if (done) {
                    const result = consume(buffer);
                    if (result) return result;
                    throw new Error('Agent response interrupted before completion');
                }
            }
        } finally {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
        }
    }

    public static startTrace(message: string): Promise<AgentTraceTask> {
        return request('/tasks', {
            method: 'POST',
            body: JSON.stringify({
                kind: 'agent_request',
                title: message.slice(0, 80),
                status: 'running',
                source_message: message,
                spec: {},
            }),
        });
    }

    public static finishTrace(
        task: AgentTraceTask,
        status: 'succeeded' | 'failed',
        result: Record<string, unknown>,
    ): Promise<AgentTraceTask> {
        return request(`/tasks/${encodeURIComponent(task.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({expected_revision: task.revision, status, result}),
        });
    }

    public static tasks(limit = 200): Promise<AgentTraceTaskList> {
        return request(`/tasks?kind=agent_request&limit=${limit}`);
    }

    public static conversations(limit = 50): Promise<AgentConversation[]> {
        return request(`/conversations?limit=${limit}`);
    }

    public static conversation(conversationId: string): Promise<AgentConversationDetail> {
        return request(`/conversations/${encodeURIComponent(conversationId)}`);
    }

    public static async recordTurn(
        userContent: string,
        assistantContent: string,
        conversationId?: string,
    ): Promise<string> {
        const id = conversationId || (await request<AgentConversation>('/conversations', {
            method: 'POST',
            body: JSON.stringify({title: userContent.slice(0, 80)}),
        })).id;
        const addMessage = (role: AgentConversationMessage['role'], content: string) => request(
            `/conversations/${encodeURIComponent(id)}/messages`, {
                method: 'POST',
                body: JSON.stringify({role, content}),
            },
        );
        await addMessage('user', userContent);
        await addMessage('assistant', assistantContent);
        return id;
    }
}
