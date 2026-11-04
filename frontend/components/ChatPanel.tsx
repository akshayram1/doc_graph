'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from '@/components/Markdown';
import { sendChatMessage, type ChatSession, type GraphInfo, type StoredMessage } from '@/lib/api';
import { typeStyle } from '@/lib/nodeTypes';

type Props = {
  chat: ChatSession;
  graphs: GraphInfo[];
  onChat: (chat: ChatSession) => void;
  onSources: (uids: string[]) => void;
  onSourceClick: (uid: string) => void;
  activeSource?: string | null;
  /** Text pushed in from elsewhere (e.g. "Ask about this" in the graph). */
  draft?: { text: string; n: number } | null;
};

function suggestions(docs: GraphInfo[]): string[] {
  if (docs.length === 0) return [];
  if (docs.length === 1) {
    const name = docs[0].name;
    return [
      `Summarize “${name}” in a few bullet points`,
      'Who are the key people and organizations?',
      'What are the most connected entities?',
    ];
  }
  const [a, b] = docs;
  return [
    `Compare “${a.name}” and “${b.name}”`,
    'Which entities appear in more than one document?',
    'Summarize each document in two lines',
  ];
}

export default function ChatPanel({ chat, graphs, onChat, onSources, onSourceClick, activeSource, draft }: Props) {
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const graphById = useMemo(() => new Map(graphs.map((g) => [g.id, g])), [graphs]);
  const scopeDocs = chat.graph_ids.map((id) => graphById.get(id)).filter(Boolean) as GraphInfo[];
  const noScope = scopeDocs.length === 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.messages.length, pending]);

  useEffect(() => {
    if (draft) {
      setInput(draft.text);
      inputRef.current?.focus();
    }
  }, [draft]);

  // Light up the sources of the latest answer when a chat opens.
  useEffect(() => {
    const last = [...chat.messages].reverse().find((m) => m.role === 'assistant');
    onSources(last?.sources.map((s) => s.uid) ?? []);
  }, [chat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || pending || noScope) return;
    setPending(message);
    setInput('');
    setError(null);
    try {
      const turn = await sendChatMessage(chat.id, message);
      onChat(turn.chat);
      onSources(turn.reply.sources.map((s) => s.uid));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chat request failed');
      setInput(message);
    } finally {
      setPending(null);
    }
  };

  const scopeChanged = (m: StoredMessage, prev?: StoredMessage) =>
    m.role === 'user' && (!prev || [...m.graph_ids].sort().join() !== [...(prev.graph_ids ?? [])].sort().join());

  return (
    <div className="chat">
      <div className="chat-log">
        {chat.messages.length === 0 && (
          <div className="chat-welcome">
            <div className="chat-welcome-mark" aria-hidden>
              <i />
              <i />
              <i />
            </div>
            <h3>{noScope ? 'Pick a graph to start' : 'Ask anything about'}</h3>
            {!noScope && (
              <div className="chat-welcome-docs">
                {scopeDocs.map((g) => (
                  <span key={g.id} className="mini-doc" style={{ ['--doc' as string]: g.color }}>
                    {g.name}
                  </span>
                ))}
              </div>
            )}
            <p className="muted">
              {noScope
                ? 'Select one or more document graphs above. Answers come only from the graphs you select.'
                : 'Answers cite the graph nodes they used. Click a source to find it in the graph.'}
            </p>
            {!noScope && (
              <div className="suggest">
                {suggestions(scopeDocs).map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)} disabled={Boolean(pending)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {chat.messages.map((m, i) => {
          const prevUser = [...chat.messages.slice(0, i)].reverse().find((x) => x.role === 'user');
          return (
            <div key={m.id}>
              {scopeChanged(m, prevUser) && m.graph_ids.length > 0 && (
                <div className="scope-divider">
                  <span>
                    Answering from{' '}
                    {m.graph_ids.map((id, idx) => (
                      <b key={id} style={{ color: graphById.get(id)?.color }}>
                        {idx > 0 ? ', ' : ''}
                        {graphById.get(id)?.name ?? 'deleted graph'}
                      </b>
                    ))}
                  </span>
                </div>
              )}
              <div className={`msg msg-${m.role}`}>
                <div className="msg-body">
                  {m.role === 'assistant' ? <Markdown text={m.content} /> : <p>{m.content}</p>}
                </div>
                {m.sources.length > 0 && (
                  <div className="msg-sources">
                    <span className="msg-sources-label">Sources</span>
                    {m.sources.map((s) => {
                      const doc = graphById.get(s.graph_id);
                      return (
                        <button
                          key={s.uid}
                          type="button"
                          className={`src ${activeSource === s.uid ? 'is-on' : ''}`}
                          onClick={() => onSourceClick(s.uid)}
                          title={`${typeStyle(s.type).label}${doc ? ` · ${doc.name}` : ''} · score ${s.score.toFixed(2)}`}
                        >
                          <span className="src-dot" style={{ background: typeStyle(s.type).color }} />
                          {s.label}
                          {m.graph_ids.length > 1 && doc && (
                            <span className="src-doc" style={{ background: doc.color }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {pending && (
          <>
            <div className="msg msg-user">
              <div className="msg-body">
                <p>{pending}</p>
              </div>
            </div>
            <div className="msg msg-assistant">
              <div className="msg-body typing">
                <span />
                <span />
                <span />
                <em className="muted">
                  Searching {scopeDocs.length > 1 ? `${scopeDocs.length} graphs` : 'the graph'}…
                </em>
              </div>
            </div>
          </>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        <div ref={endRef} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder={
            noScope
              ? 'Select a graph above to start chatting'
              : scopeDocs.length > 1
                ? `Ask across ${scopeDocs.length} graphs…`
                : `Ask about ${scopeDocs[0].name}…`
          }
          disabled={noScope || Boolean(pending)}
          aria-label="Message"
        />
        <button type="submit" className="send" disabled={noScope || Boolean(pending) || !input.trim()} aria-label="Send">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
            <path d="M3 10h12M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </div>
  );
}
