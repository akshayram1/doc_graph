export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000';

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
};

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return typeof body.detail === 'string' ? body.detail : `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, { cache: 'no-store', ...init });
  if (!response.ok) {
    throw new Error(await readError(response));
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
