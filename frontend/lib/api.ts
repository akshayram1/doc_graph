const configuredApiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');

export const apiUrl = configuredApiUrl;

function apiBase(): string {
  if (typeof window !== 'undefined') {
    return '';
  }
  return configuredApiUrl;
}

export type BackendStatus = {
  app: string;
  environment: string;
  status: string;
  timestamp: string;
  collection: string;
  qdrantConfigured: boolean;
  chatConfigured: boolean;
};

/** One uploaded document = one graph. */
export type GraphInfo = {
  id: string;
  name: string;
  filename: string;
  color: string;
  node_count: number;
  edge_count: number;
  created_at: string;
};

export type GraphNode = {
  uid: string;
  key: string;
  graph_id: string;
  label: string;
  type: string;
  text?: string | null;
};

export type GraphEdge = {
  source: string;
  target: string;
  type: string;
  cross: boolean;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type SearchHit = {
  uid: string;
  key: string;
  graph_id: string;
  label: string;
  type: string;
  text: string;
  score: number;
};

export type StoredMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  graph_ids: string[];
  sources: SearchHit[];
};

export type ChatSummary = {
  id: string;
  title: string;
  graph_ids: string[];
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message: string;
};

export type ChatSession = {
  id: string;
  title: string;
  graph_ids: string[];
  created_at: string;
  updated_at: string;
  messages: StoredMessage[];
};

export type ChatTurn = {
  chat: ChatSession;
  reply: StoredMessage;
};

export type UploadResponse = {
  graph: GraphInfo;
  extracted_nodes: number;
  ingested_nodes: number;
  collection: string;
  debug?: string[];
};

export type ApiFailure = Error & { debug: string[] };

function asFailure(message: string, debug: string[] = []): ApiFailure {
  const error = new Error(message) as ApiFailure;
  error.debug = debug;
  return error;
}

async function readError(response: Response): Promise<ApiFailure> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { detail?: unknown; message?: unknown; debug?: unknown };
    const topDebug = Array.isArray(body.debug) ? body.debug.map(String) : [];
    const detail = body.detail;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const record = detail as { message?: unknown; debug?: unknown };
      const debug = Array.isArray(record.debug) ? record.debug.map(String) : topDebug;
      const message = typeof record.message === 'string' ? record.message : `Request failed (${response.status})`;
      return asFailure(message, debug);
    }
    if (typeof detail === 'string' && detail.trim()) return asFailure(detail, topDebug);
    if (typeof body.message === 'string' && body.message.trim()) return asFailure(body.message, topDebug);
  } catch {
    const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (plain) return asFailure(plain.slice(0, 400));
  }
  return asFailure(`Request failed (${response.status})`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, { cache: 'no-store', ...init });
  } catch {
    throw new Error(
      'Cannot reach the API. On Windows, stop the app and start it again with run.bat so the backend is running on http://127.0.0.1:8000.'
    );
  }
  if (!response.ok) {
    throw await readError(response);
  }
  return response.json();
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function getBackendStatus(): Promise<BackendStatus | null> {
  try {
    return await request<BackendStatus>('/api/status');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- graphs

export const listGraphs = () => request<GraphInfo[]>('/api/graphs');

export const deleteGraph = (id: string) =>
  request<{ id: string; deleted_nodes: number }>(`/api/graphs/${id}`, { method: 'DELETE' });

/** Merged graph for the given documents. An empty list returns an empty graph. */
export const getGraph = (graphIds: string[]) =>
  request<GraphData>(`/api/graph?graph_ids=${encodeURIComponent(graphIds.join(','))}`);

export function uploadFile(file: File, name?: string): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  if (name?.trim()) formData.append('name', name.trim());
  return request<UploadResponse>('/api/upload', { method: 'POST', body: formData });
}

// ---------------------------------------------------------------- chats

export const listChats = () => request<ChatSummary[]>('/api/chats');

export const getChat = (id: string) => request<ChatSession>(`/api/chats/${id}`);

export const createChat = (graphIds: string[], title?: string) =>
  request<ChatSession>('/api/chats', json('POST', { graph_ids: graphIds, title }));

export const updateChat = (id: string, patch: { title?: string; graph_ids?: string[] }) =>
  request<ChatSession>(`/api/chats/${id}`, json('PATCH', patch));

export const deleteChat = (id: string) =>
  request<{ id: string }>(`/api/chats/${id}`, { method: 'DELETE' });

export const sendChatMessage = (id: string, message: string, graphIds?: string[]) =>
  request<ChatTurn>(`/api/chats/${id}/messages`, json('POST', { message, graph_ids: graphIds }));
