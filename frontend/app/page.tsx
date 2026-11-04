'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NewChatDialog, UploadDialog } from '@/components/Dialogs';
import {
  createChat,
  deleteChat,
  deleteGraph,
  getBackendStatus,
  listChats,
  listGraphs,
  type BackendStatus,
  type ChatSummary,
  type GraphInfo,
} from '@/lib/api';
import { plural, timeAgo } from '@/lib/format';

export default function Workspace() {
  const router = useRouter();
  const [graphs, setGraphs] = useState<GraphInfo[] | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [status, setStatus] = useState<BackendStatus | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [newChatWith, setNewChatWith] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [g, c] = await Promise.all([listGraphs(), listChats()]);
      setGraphs(g);
      setChats(c);
      setError(null);
    } catch (cause) {
      setGraphs([]);
      setError(cause instanceof Error ? cause.message : 'Could not reach the API');
    }
  }, []);

  useEffect(() => {
    void refresh();
    void getBackendStatus().then(setStatus);
  }, [refresh]);

  const graphById = useMemo(() => new Map((graphs ?? []).map((g) => [g.id, g])), [graphs]);

  const quickChat = async (ids: string[]) => {
    const chat = await createChat(ids);
    router.push(`/chat/${chat.id}`);
  };

  const removeGraph = async (g: GraphInfo) => {
    if (!window.confirm(`Delete “${g.name}” and its ${g.node_count} nodes? Chats keep their messages but lose this graph.`)) return;
    await deleteGraph(g.id);
    setPicked((prev) => prev.filter((id) => id !== g.id));
    await refresh();
  };

  const removeChat = async (c: ChatSummary) => {
    if (!window.confirm(`Delete the chat “${c.title}”?`)) return;
    await deleteChat(c.id);
    await refresh();
  };

  const togglePick = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          Finsk
        </Link>
        <nav className="topbar-nav">
          <Link href="/graph" className="btn btn-ghost btn-sm">
            Graph explorer
          </Link>
          <span className={`status-pill ${status ? 'ok' : status === null ? 'down' : ''}`}>
            <span className="dot" />
            {status === undefined ? 'Checking…' : status ? 'API online' : 'API offline'}
          </span>
        </nav>
      </header>

      <main className="workspace">
        <section className="ws-hero">
          <div>
            <h1>Chat with your documents</h1>
            <p className="muted">
              Every upload becomes its own knowledge graph. Open a chat on one graph, or select several and ask
              across them.
            </p>
          </div>
          <div className="ws-hero-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowUpload(true)}>
              ＋ Add document
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setNewChatWith(picked)}
              disabled={!graphs || graphs.length === 0}
            >
              New chat
            </button>
          </div>
        </section>

        {error && <div className="alert alert-error">{error}</div>}
        {notice && (
          <div className="alert alert-ok" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}

        <div className="ws-grid">
          {/* Documents */}
          <section className="ws-section">
            <div className="ws-section-head">
              <h2>
                Document graphs <span className="count">{graphs?.length ?? 0}</span>
              </h2>
              {picked.length > 0 && (
                <div className="pick-bar">
                  <span>{picked.length} selected</span>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPicked([])}>
                    Clear
                  </button>
                  <Link className="btn btn-sm btn-ghost" href={`/graph?ids=${picked.join(',')}`}>
                    View together
                  </Link>
                  <button type="button" className="btn btn-sm" onClick={() => void quickChat(picked)}>
                    Chat with {picked.length > 1 ? `these ${picked.length}` : 'this'}
                  </button>
                </div>
              )}
            </div>

            <div className="doc-grid">
              {graphs === null &&
                [0, 1].map((i) => <div key={i} className="doc-card skeleton" aria-hidden />)}

              {graphs?.map((g) => {
                const on = picked.includes(g.id);
                const chatCount = chats.filter((c) => c.graph_ids.includes(g.id)).length;
                return (
                  <article
                    key={g.id}
                    className={`doc-card ${on ? 'is-picked' : ''}`}
                    style={{ ['--doc' as string]: g.color }}
                  >
                    <button
                      type="button"
                      className="doc-check"
                      onClick={() => togglePick(g.id)}
                      aria-pressed={on}
                      aria-label={`Select ${g.name}`}
                      title="Select to chat with several documents at once"
                    >
                      {on ? '✓' : ''}
                    </button>
                    <div className="doc-card-body" onClick={() => togglePick(g.id)}>
                      <span className="doc-chip">{/\.([a-z0-9]{1,5})$/i.exec(g.filename)?.[1].toUpperCase() ?? 'DOC'}</span>
                      <h3>{g.name}</h3>
                      <p className="muted doc-file" title={g.filename}>
                        {g.filename}
                      </p>
                      <div className="doc-stats">
                        <span>
                          <b>{g.node_count}</b> nodes
                        </span>
                        <span>
                          <b>{g.edge_count}</b> links
                        </span>
                        <span>
                          <b>{chatCount}</b> {chatCount === 1 ? 'chat' : 'chats'}
                        </span>
                      </div>
                    </div>
                    <div className="doc-actions">
                      <button type="button" className="btn btn-sm" onClick={() => void quickChat([g.id])}>
                        Chat
                      </button>
                      <Link className="btn btn-sm btn-ghost" href={`/graph?ids=${g.id}`}>
                        Graph
                      </Link>
                      <span className="spacer" />
                      <span className="muted tiny">{timeAgo(g.created_at)}</span>
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() => void removeGraph(g)}
                        aria-label={`Delete ${g.name}`}
                        title="Delete document graph"
                      >
                        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden>
                          <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" fill="none" stroke="currentColor" strokeWidth="1.6" />
                        </svg>
                      </button>
                    </div>
                  </article>
                );
              })}

              {graphs && (
                <button type="button" className="doc-card doc-add" onClick={() => setShowUpload(true)}>
                  <span className="doc-add-icon">＋</span>
                  <strong>Add document</strong>
                  <span className="muted">PDF or CSV → knowledge graph</span>
                </button>
              )}
            </div>
          </section>

          {/* Chats */}
          <section className="ws-section">
            <div className="ws-section-head">
              <h2>
                Chats <span className="count">{chats.length}</span>
              </h2>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setNewChatWith(picked)}
                disabled={!graphs || graphs.length === 0}
              >
                ＋ New
              </button>
            </div>

            {chats.length === 0 ? (
              <div className="empty-card">
                <strong>No chats yet</strong>
                <p className="muted">
                  {graphs && graphs.length > 0
                    ? 'Start one on a document, or select a few documents and chat across them.'
                    : 'Add a document to get started.'}
                </p>
              </div>
            ) : (
              <ul className="chat-list">
                {chats.map((c) => (
                  <li key={c.id}>
                    <Link href={`/chat/${c.id}`} className="chat-row">
                      <div className="chat-row-top">
                        <strong className="chat-row-title">{c.title}</strong>
                        <span className="muted tiny">{timeAgo(c.updated_at)}</span>
                      </div>
                      {c.last_message && <p className="chat-row-last muted">{c.last_message.replace(/[*#`_]/g, '')}</p>}
                      <div className="chat-row-docs">
                        {c.graph_ids.length === 0 && <span className="muted tiny">No graph selected</span>}
                        {c.graph_ids.map((id) => {
                          const g = graphById.get(id);
                          return g ? (
                            <span key={id} className="mini-doc" style={{ ['--doc' as string]: g.color }}>
                              {g.name}
                            </span>
                          ) : null;
                        })}
                        <span className="spacer" />
                        <span className="muted tiny">{plural(c.message_count, 'message')}</span>
                      </div>
                    </Link>
                    <button
                      type="button"
                      className="icon-btn danger chat-row-del"
                      onClick={() => void removeChat(c)}
                      aria-label={`Delete chat ${c.title}`}
                      title="Delete chat"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      {showUpload && (
        <UploadDialog
          onClose={() => setShowUpload(false)}
          onUploaded={(result) => {
            setShowUpload(false);
            setNotice(
              `“${result.graph.name}” is ready: ${result.extracted_nodes} nodes, ${result.graph.edge_count} links.`
            );
            setPicked((prev) => [...prev, result.graph.id]);
            void refresh();
          }}
        />
      )}
      {newChatWith && graphs && (
        <NewChatDialog graphs={graphs} initial={newChatWith} onClose={() => setNewChatWith(null)} />
      )}
    </div>
  );
}
