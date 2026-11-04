'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import DocToggleBar from '@/components/DocToggleBar';
import GraphVisualizer from '@/components/GraphVisualizer';
import { createChat, deleteGraph, listGraphs, type GraphInfo } from '@/lib/api';

function Explorer() {
  const router = useRouter();
  const params = useSearchParams();
  const [graphs, setGraphs] = useState<GraphInfo[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGraphs()
      .then((g) => {
        setGraphs(g);
        const fromUrl = (params.get('ids') ?? '').split(',').filter((id) => g.some((x) => x.id === id));
        setIds(fromUrl.length ? fromUrl : g.map((x) => x.id));
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load graphs'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: string[]) => {
    setIds(next);
    router.replace(`/graph?ids=${next.join(',')}`, { scroll: false });
  };

  const removeGraphs = async () => {
    const chosen = graphs.filter((graph) => ids.includes(graph.id));
    if (chosen.length === 0) return;
    const label = chosen.length === 1 ? `“${chosen[0].name}”` : `${chosen.length} graphs`;
    if (!window.confirm(`Delete ${label}? The nodes are removed from Qdrant. Chats keep their messages.`)) return;
    try {
      await Promise.all(chosen.map((graph) => deleteGraph(graph.id)));
      router.push('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the graph');
    }
  };

  return (
    <div className="explorer">
      <header className="explorer-top">
        <Link href="/" className="brand brand-sm">
          <span className="brand-mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          Finsk
        </Link>
        <DocToggleBar graphs={graphs} selected={ids} onChange={change} label="Showing" />
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-danger" disabled={ids.length === 0} onClick={() => void removeGraphs()}>
          {ids.length > 1 ? 'Delete graphs' : 'Delete graph'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={ids.length === 0}
          onClick={async () => router.push(`/chat/${(await createChat(ids)).id}`)}
        >
          Chat with {ids.length > 1 ? `these ${ids.length}` : 'this graph'}
        </button>
      </header>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="explorer-stage">
        <GraphVisualizer
          graphs={graphs}
          graphIds={ids}
          title={ids.length === 1 ? graphs.find((g) => g.id === ids[0])?.name ?? 'Graph' : `${ids.length} document graphs`}
        />
      </div>
    </div>
  );
}

export default function GraphPage() {
  return (
    <Suspense fallback={null}>
      <Explorer />
    </Suspense>
  );
}
