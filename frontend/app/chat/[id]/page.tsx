'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatPanel from '@/components/ChatPanel';
import DocToggleBar from '@/components/DocToggleBar';
import { NewChatDialog } from '@/components/Dialogs';
import GraphVisualizer from '@/components/GraphVisualizer';
import {
  getChat,
  listChats,
  listGraphs,
  updateChat,
  type ChatSession,
  type ChatSummary,
  type GraphInfo,
} from '@/lib/api';
import { timeAgo } from '@/lib/format';

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [chat, setChat] = useState<ChatSession | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [graphs, setGraphs] = useState<GraphInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ text: string; n: number } | null>(null);
  const [showGraph, setShowGraph] = useState(true);
  const [showSidebar, setShowSidebar] = useState(true);
  const [newChat, setNewChat] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [split, setSplit] = useState(44);
  const splitRef = useRef<HTMLDivElement | null>(null);

  const refreshList = useCallback(() => listChats().then(setChats).catch(() => {}), []);

  useEffect(() => {
    setChat(null);
    setHighlighted([]);
    setFocus(null);
    Promise.all([getChat(id), listGraphs()])
      .then(([c, g]) => {
        setChat(c);
        setGraphs(g);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Chat not found'));
    void refreshList();
  }, [id, refreshList]);

  const graphById = useMemo(() => new Map(graphs.map((g) => [g.id, g])), [graphs]);

  const changeScope = async (ids: string[]) => {
    if (!chat) return;
    setFocus(null);
    setChat({ ...chat, graph_ids: ids }); // optimistic
    try {
      setChat(await updateChat(chat.id, { graph_ids: ids }));
      void refreshList();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the chat');
    }
  };

  const rename = async (title: string) => {
    setEditingTitle(false);
    if (!chat || !title.trim() || title === chat.title) return;
    setChat(await updateChat(chat.id, { title }));
    void refreshList();
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const box = splitRef.current?.getBoundingClientRect();
    if (!box) return;
    const move = (ev: PointerEvent) => {
      setSplit(Math.min(70, Math.max(28, ((ev.clientX - box.left) / box.width) * 100)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('is-resizing');
    };
    document.body.classList.add('is-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={`chat-app ${showSidebar ? '' : 'no-sidebar'}`}>
      {/* Sidebar: every chat window */}
      <aside className="sidebar">
        <div className="sidebar-head">
          <Link href="/" className="brand brand-sm">
            <span className="brand-mark" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            Finsk
          </Link>
          <button type="button" className="icon-btn" onClick={() => setShowSidebar(false)} aria-label="Hide chat list">
            «
          </button>
        </div>
        <button type="button" className="btn btn-block" onClick={() => setNewChat(true)}>
          ＋ New chat
        </button>
        <Link href="/" className="sidebar-link">
          ← All documents & chats
        </Link>
        <div className="sidebar-label">Chats</div>
        <ul className="sidebar-list">
          {chats.map((c) => (
            <li key={c.id}>
              <Link href={`/chat/${c.id}`} className={`sidebar-item ${c.id === id ? 'is-active' : ''}`}>
                <span className="sidebar-item-title">{c.title}</span>
                <span className="sidebar-item-meta">
                  <span className="doc-dots">
                    {c.graph_ids.slice(0, 5).map((gid) => (
                      <span key={gid} style={{ background: graphById.get(gid)?.color ?? '#cbd5e1' }} />
                    ))}
                  </span>
                  {timeAgo(c.updated_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <main className="chat-main">
        <header className="chat-top">
          <div className="chat-top-row">
            {!showSidebar && (
              <button type="button" className="icon-btn" onClick={() => setShowSidebar(true)} aria-label="Show chat list">
                »
              </button>
            )}
            {editingTitle && chat ? (
              <input
                className="title-input"
                defaultValue={chat.title}
                autoFocus
                onBlur={(e) => void rename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void rename((e.target as HTMLInputElement).value);
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
              />
            ) : (
              <h1 className="chat-title" onDoubleClick={() => setEditingTitle(true)} title="Double-click to rename">
                {chat?.title ?? (error ? 'Chat not found' : 'Loading…')}
              </h1>
            )}
            <span className="spacer" />
            <button
              type="button"
              className={`btn btn-sm ${showGraph ? 'btn-ghost' : ''}`}
              onClick={() => setShowGraph((v) => !v)}
            >
              {showGraph ? 'Hide graph' : 'Show graph'}
            </button>
          </div>
          {chat && (
            <DocToggleBar
              graphs={graphs}
              selected={chat.graph_ids}
              onChange={(ids) => void changeScope(ids)}
              label="Chatting with"
            />
          )}
        </header>

        {error && !chat && (
          <div className="center-note">
            <strong>{error}</strong>
            <button type="button" className="btn" onClick={() => router.push('/')}>
              Back to workspace
            </button>
          </div>
        )}

        {chat && (
          <div
            ref={splitRef}
            className={`split ${showGraph ? '' : 'split-single'}`}
            style={showGraph ? { gridTemplateColumns: `${split}% 8px 1fr` } : undefined}
          >
            <ChatPanel
              chat={chat}
              graphs={graphs}
              onChat={(c) => {
                setChat(c);
                void refreshList();
              }}
              onSources={setHighlighted}
              onSourceClick={(uid) => {
                setShowGraph(true);
                setFocus(null);
                requestAnimationFrame(() => setFocus(uid));
              }}
              activeSource={focus}
              draft={draft}
            />
            {showGraph && (
              <>
                <div className="split-handle" onPointerDown={startResize} title="Drag to resize" />
                <GraphVisualizer
                  graphs={graphs}
                  graphIds={chat.graph_ids}
                  highlightedUids={highlighted}
                  focusUid={focus}
                  onSelectNode={setFocus}
                  onAskAbout={(node) =>
                    setDraft({ text: `Tell me about ${node.label}`, n: Date.now() })
                  }
                  title={chat.graph_ids.length > 1 ? `${chat.graph_ids.length} graphs` : graphById.get(chat.graph_ids[0])?.name ?? 'Graph'}
                />
              </>
            )}
          </div>
        )}
      </main>

      {newChat && <NewChatDialog graphs={graphs} initial={chat?.graph_ids ?? []} onClose={() => setNewChat(false)} />}
    </div>
  );
}
