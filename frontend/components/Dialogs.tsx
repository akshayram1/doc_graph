'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createChat, uploadFile, type GraphInfo, type UploadResponse } from '@/lib/api';
import { plural } from '@/lib/format';

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- upload

export function UploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: (result: UploadResponse) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (ext !== 'csv' && ext !== 'pdf') {
      setError('Only .pdf and .csv files are supported.');
      return;
    }
    setError(null);
    setFile(f);
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onUploaded(await uploadFile(file, name));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add a document"
      subtitle="Each document becomes its own knowledge graph you can chat with."
      onClose={busy ? () => {} : onClose}
    >
      <div
        className={`dropzone ${dragging ? 'is-drag' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files?.[0]);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.pdf"
          hidden
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {file ? (
          <>
            <span className="file-badge">{file.name.split('.').pop()?.toUpperCase()}</span>
            <strong>{file.name}</strong>
            <span className="muted">{(file.size / 1024).toFixed(0)} KB · click to choose another</span>
          </>
        ) : (
          <>
            <span className="dropzone-icon" aria-hidden>
              ↑
            </span>
            <strong>Drop a PDF or CSV here</strong>
            <span className="muted">or click to browse · up to 15 MB</span>
          </>
        )}
      </div>

      <label className="field">
        <span>Graph name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Placement report 2026" disabled={busy} />
      </label>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="modal-actions">
        {busy && (
          <span className="busy-note">
            <span className="spinner" /> Extracting entities and relations… this can take a minute.
          </span>
        )}
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={() => void submit()} disabled={!file || busy}>
          {busy ? 'Building graph…' : 'Build graph'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- new chat

export function NewChatDialog({
  graphs,
  initial = [],
  onClose,
}: {
  graphs: GraphInfo[];
  initial?: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(initial.length ? initial : graphs.length === 1 ? [graphs[0].id] : []);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const chat = await createChat(selected, title);
      router.push(`/chat/${chat.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create chat');
      setBusy(false);
    }
  };

  return (
    <Modal title="New chat" subtitle="Choose which document graphs this chat answers from. You can change it later." onClose={onClose}>
      <label className="field">
        <span>Title (optional)</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Named after your first question if left blank"
          autoFocus
        />
      </label>

      <div className="field">
        <span>
          Documents <em className="muted">· {selected.length} selected</em>
        </span>
        {graphs.length === 0 ? (
          <p className="muted">Upload a document first.</p>
        ) : (
          <div className="pick-list">
            {graphs.map((g) => {
              const on = selected.includes(g.id);
              return (
                <button
                  type="button"
                  key={g.id}
                  className={`pick ${on ? 'is-on' : ''}`}
                  style={{ ['--doc' as string]: g.color }}
                  onClick={() => toggle(g.id)}
                  aria-pressed={on}
                >
                  <span className="pick-box" aria-hidden>
                    {on ? '✓' : ''}
                  </span>
                  <span className="pick-body">
                    <strong>{g.name}</strong>
                    <span className="muted">
                      {plural(g.node_count, 'node')} · {plural(g.edge_count, 'link')}
                    </span>
                  </span>
                  <span className="pick-swatch" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={() => void start()} disabled={busy || selected.length === 0}>
          {busy
            ? 'Creating…'
            : selected.length > 1
              ? `Chat with ${selected.length} graphs`
              : 'Start chat'}
        </button>
      </div>
    </Modal>
  );
}
