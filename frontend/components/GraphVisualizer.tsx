'use client';

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getGraph, type GraphData, type GraphInfo, type GraphNode } from '@/lib/api';
import { relationLabel, typeStyle } from '@/lib/nodeTypes';

type SimNode = GraphNode & SimulationNodeDatum & { degree: number; r: number };
type SimLink = SimulationLinkDatum<SimNode> & { type: string; cross: boolean; source: SimNode; target: SimNode };
type Layout = 'network' | 'documents' | 'types';
type View = { k: number; x: number; y: number };

export type GraphVisualizerProps = {
  /** Every known document, used for names and colours. */
  graphs: GraphInfo[];
  /** Documents to draw. */
  graphIds: string[];
  /** Nodes to light up, e.g. the sources of the latest answer. */
  highlightedUids?: string[];
  /** Select and centre this node when it changes. */
  focusUid?: string | null;
  onSelectNode?: (uid: string | null) => void;
  /** Shows an "Ask about this" action in the inspector. */
  onAskAbout?: (node: GraphNode) => void;
  reloadKey?: number;
  title?: string;
};

const LAYOUTS: { id: Layout; label: string }[] = [
  { id: 'network', label: 'Network' },
  { id: 'documents', label: 'By document' },
  { id: 'types', label: 'By type' },
];

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 5;
const FONT = '500 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

function radiusFor(degree: number) {
  return Math.min(6 + Math.sqrt(degree) * 2.6, 20);
}

function ringPositions(ids: string[], radius: number) {
  const out = new Map<string, { x: number; y: number }>();
  ids.forEach((id, i) => {
    if (ids.length === 1) {
      out.set(id, { x: 0, y: 0 });
      return;
    }
    const angle = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
    out.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });
  return out;
}

export default function GraphVisualizer({
  graphs,
  graphIds,
  highlightedUids = [],
  focusUid = null,
  onSelectNode,
  onAskAbout,
  reloadKey = 0,
  title = 'Knowledge graph',
}: GraphVisualizerProps) {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>('network');
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [hiddenGraphs, setHiddenGraphs] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ w: 800, h: 600, dpr: 1 });
  const viewRef = useRef<View>({ k: 1, x: 400, y: 300 });
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const positionsRef = useRef(new Map<string, { x: number; y: number }>());
  const drawRef = useRef<() => void>(() => {});
  const frameRef = useRef<number | null>(null);
  const userMovedRef = useRef(false);
  const dragRef = useRef<{
    mode: 'pan' | 'node';
    uid?: string;
    startX: number;
    startY: number;
    viewX: number;
    viewY: number;
    moved: boolean;
  } | null>(null);
  const tweenRef = useRef<number | null>(null);

  const graphById = useMemo(() => new Map(graphs.map((g) => [g.id, g])), [graphs]);
  const idsKey = [...graphIds].sort().join(',');
  const multiDoc = graphIds.length > 1;

  // ------------------------------------------------------------ data

  const load = useCallback(async () => {
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length === 0) {
      setData({ nodes: [], edges: [] });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await getGraph(ids));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load graph');
    } finally {
      setLoading(false);
    }
  }, [idsKey]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  useEffect(() => {
    setHiddenGraphs((prev) => {
      const next = [...prev].filter((id) => graphIds.includes(id));
      return next.length === prev.size ? prev : new Set(next);
    });
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const typeCounts = new Map<string, number>();
    const graphCounts = new Map<string, number>();
    const adjacency = new Map<string, Set<string>>();
    for (const node of data?.nodes ?? []) {
      typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1);
      graphCounts.set(node.graph_id, (graphCounts.get(node.graph_id) ?? 0) + 1);
      adjacency.set(node.uid, new Set());
    }
    for (const edge of data?.edges ?? []) {
      adjacency.get(edge.source)?.add(edge.target);
      adjacency.get(edge.target)?.add(edge.source);
    }
    const types = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
    const bridges = (data?.edges ?? []).filter((e) => e.cross).length;
    return { typeCounts, graphCounts, adjacency, types, bridges };
  }, [data]);

  const visible = useMemo(() => {
    const nodes = (data?.nodes ?? []).filter(
      (n) => !hiddenTypes.has(n.type) && !hiddenGraphs.has(n.graph_id)
    );
    const keep = new Set(nodes.map((n) => n.uid));
    const edges = (data?.edges ?? []).filter((e) => keep.has(e.source) && keep.has(e.target));
    return { nodes, edges, keep };
  }, [data, hiddenTypes, hiddenGraphs]);

  // ------------------------------------------------------------ simulation

  const requestDraw = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      drawRef.current();
    });
  }, []);

  const fit = useCallback(
    (animate = true) => {
      const nodes = nodesRef.current;
      if (nodes.length === 0) return;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, (n.x ?? 0) - n.r - 40);
        maxX = Math.max(maxX, (n.x ?? 0) + n.r + 40);
        minY = Math.min(minY, (n.y ?? 0) - n.r - 20);
        maxY = Math.max(maxY, (n.y ?? 0) + n.r + 30);
      }
      const { w, h } = sizeRef.current;
      const pad = 40;
      const k = Math.min(
        Math.max(Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY)), MIN_ZOOM),
        1.8
      );
      const target = { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k };
      animateTo(target, animate ? 420 : 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function animateTo(target: View, duration: number) {
    if (tweenRef.current != null) cancelAnimationFrame(tweenRef.current);
    const from = { ...viewRef.current };
    if (duration <= 0) {
      viewRef.current = target;
      requestDraw();
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const e = 1 - Math.pow(1 - t, 3);
      viewRef.current = {
        k: from.k + (target.k - from.k) * e,
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
      };
      drawRef.current();
      tweenRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    tweenRef.current = requestAnimationFrame(step);
  }

  useEffect(() => {
    // Remember where nodes were so reloading or filtering doesn't scramble the picture.
    for (const n of nodesRef.current) {
      if (n.x != null && n.y != null) positionsRef.current.set(n.uid, { x: n.x, y: n.y });
    }

    const visibleGraphIds = graphIds.filter((id) => !hiddenGraphs.has(id));
    const docCenters = ringPositions(visibleGraphIds, 120 + visibleGraphIds.length * 70);
    const typeCenters = ringPositions(
      stats.types.map(([t]) => t).filter((t) => !hiddenTypes.has(t)),
      140 + stats.types.length * 22
    );

    const fresh = visible.nodes.some((n) => !positionsRef.current.has(n.uid));
    const nodes: SimNode[] = visible.nodes.map((n, i) => {
      const degree = stats.adjacency.get(n.uid)?.size ?? 0;
      const prev = positionsRef.current.get(n.uid);
      const center = layout === 'documents' ? docCenters.get(n.graph_id) ?? { x: 0, y: 0 } : { x: 0, y: 0 };
      const angle = i * 2.399963; // golden angle spiral for a tidy start
      const dist = 12 * Math.sqrt(i + 1);
      return {
        ...n,
        degree,
        r: radiusFor(degree),
        x: prev?.x ?? center.x + Math.cos(angle) * dist,
        y: prev?.y ?? center.y + Math.sin(angle) * dist,
      };
    });
    const byUid = new Map(nodes.map((n) => [n.uid, n]));
    const links: SimLink[] = visible.edges.map((e) => ({
      source: byUid.get(e.source)!,
      target: byUid.get(e.target)!,
      type: e.type,
      cross: e.cross,
    }));

    nodesRef.current = nodes;
    linksRef.current = links;

    const strength = layout === 'network' ? 0.04 : 0.16;
    const anchor = (n: SimNode) =>
      layout === 'documents'
        ? docCenters.get(n.graph_id) ?? { x: 0, y: 0 }
        : layout === 'types'
          ? typeCenters.get(n.type) ?? { x: 0, y: 0 }
          : { x: 0, y: 0 };

    simRef.current?.stop();
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.uid)
          .distance((l) => (l.cross ? 90 : 46 + l.source.r + l.target.r))
          .strength((l) => (l.cross ? (layout === 'documents' ? 0.02 : 0.15) : layout === 'network' ? 0.5 : 0.25))
      )
      .force('charge', forceManyBody<SimNode>().strength((d) => -140 - d.r * 14).distanceMax(520))
      .force('collide', forceCollide<SimNode>((d) => d.r + 10).iterations(2))
      .force('x', forceX<SimNode>((d) => anchor(d).x).strength(strength))
      .force('y', forceY<SimNode>((d) => anchor(d).y).strength(strength))
      .alpha(fresh ? 1 : 0.5)
      .alphaDecay(0.028);

    let ticks = 0;
    sim.on('tick', () => {
      ticks += 1;
      if (!userMovedRef.current && (ticks === 1 || ticks === 60)) fit(ticks !== 1);
      requestDraw();
    });
    sim.on('end', () => {
      if (!userMovedRef.current) fit(true);
    });
    simRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [visible, layout, idsKey, hiddenGraphs, hiddenTypes, stats, fit, requestDraw]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new set of documents is a new picture: frame it again.
  useEffect(() => {
    userMovedRef.current = false;
    setSelected(null);
  }, [idsKey]);

  // ------------------------------------------------------------ focus & highlight

  const highlightSet = useMemo(() => new Set(highlightedUids), [highlightedUids]);

  const searchMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return visible.nodes
      .filter((n) => n.label.toLowerCase().includes(q) || n.type.toLowerCase().includes(q) || (n.text ?? '').toLowerCase().includes(q))
      .sort((a, b) => Number(!a.label.toLowerCase().includes(q)) - Number(!b.label.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [query, visible.nodes]);
  const searchSet = useMemo(() => new Set(searchMatches.map((n) => n.uid)), [searchMatches]);

  const centerOn = useCallback(
    (uid: string, zoom?: number) => {
      const node = nodesRef.current.find((n) => n.uid === uid);
      if (!node || node.x == null || node.y == null) return;
      const { w, h } = sizeRef.current;
      const k = zoom ?? Math.max(viewRef.current.k, 1.3);
      // Keep clear of the inspector drawer on the right.
      const drawer = Math.min(320, w * 0.92);
      const offset = w - drawer > 160 ? drawer / 2 : 0;
      userMovedRef.current = true;
      animateTo({ k, x: w / 2 - offset - node.x * k, y: h / 2 - node.y * k }, 480);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const select = useCallback(
    (uid: string | null, center = false) => {
      setSelected(uid);
      onSelectNode?.(uid);
      if (uid && center) centerOn(uid);
    },
    [centerOn, onSelectNode]
  );

  // Apply an external focus once, as soon as that node is on screen.
  const pendingFocusRef = useRef<string | null>(null);
  useEffect(() => {
    pendingFocusRef.current = focusUid;
  }, [focusUid]);
  useEffect(() => {
    const uid = pendingFocusRef.current;
    if (uid && visible.keep.has(uid)) {
      pendingFocusRef.current = null;
      setSelected(uid);
      // Wait a frame so a freshly loaded graph has positions.
      requestAnimationFrame(() => centerOn(uid));
    }
  }, [focusUid, visible.keep, centerOn]);

  // Gently pulse highlighted nodes.
  useEffect(() => {
    if (highlightSet.size === 0) {
      requestDraw();
      return;
    }
    let id = 0;
    const started = performance.now();
    const loop = () => {
      drawRef.current();
      if (performance.now() - started < 6000) id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [highlightSet, requestDraw]);

  // ------------------------------------------------------------ drawing

  drawRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    const { k, x: tx, y: ty } = viewRef.current;
    const nodes = nodesRef.current;
    const links = linksRef.current;
    const css = getComputedStyle(canvas);
    const ink = css.getPropertyValue('--graph-ink').trim() || '#0f172a';
    const edgeColor = css.getPropertyValue('--graph-edge').trim() || '#94a3b8';
    const dotColor = css.getPropertyValue('--graph-dot').trim() || '#e2e8f0';
    const halo = css.getPropertyValue('--graph-halo').trim() || '#ffffff';

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Dot grid in screen space, moving with the pan.
    const gap = 26 * Math.max(0.6, Math.min(k, 1.6));
    ctx.fillStyle = dotColor;
    for (let gx = ((tx % gap) + gap) % gap; gx < w; gx += gap) {
      for (let gy = ((ty % gap) + gap) % gap; gy < h; gy += gap) {
        ctx.fillRect(gx, gy, 1.4, 1.4);
      }
    }

    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);

    const candidate = hovered ?? selected;
    const focus = candidate && stats.adjacency.has(candidate) ? candidate : null;
    const focusSet = focus ? new Set([focus, ...(stats.adjacency.get(focus) ?? [])]) : null;
    const dimmingBy: Set<string> | null =
      focusSet ?? (searchSet.size > 0 ? searchSet : highlightSet.size > 0 ? highlightSet : null);
    const pulse = (Math.sin(performance.now() / 320) + 1) / 2;

    // Document territories when several documents are laid out apart.
    if (multiDoc && layout === 'documents') {
      const groups = new Map<string, SimNode[]>();
      for (const n of nodes) groups.set(n.graph_id, [...(groups.get(n.graph_id) ?? []), n]);
      for (const [gid, members] of groups) {
        const cx = members.reduce((s, n) => s + (n.x ?? 0), 0) / members.length;
        const cy = members.reduce((s, n) => s + (n.y ?? 0), 0) / members.length;
        const rad = Math.max(...members.map((n) => Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy) + n.r)) + 34;
        const color = graphById.get(gid)?.color ?? '#94a3b8';
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fillStyle = `${color}0f`;
        ctx.fill();
        ctx.setLineDash([6 / k, 6 / k]);
        ctx.strokeStyle = `${color}55`;
        ctx.lineWidth = 1.2 / k;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `600 ${13 / k}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.fillText(graphById.get(gid)?.name ?? gid, cx, cy - rad - 8 / k);
      }
    }

    // Edges. Relation labels only when they stay readable.
    const activeCount = focus ? (stats.adjacency.get(focus)?.size ?? 0) : 0;
    for (const link of links) {
      const s = link.source;
      const t = link.target;
      if (s.x == null || s.y == null || t.x == null || t.y == null) continue;
      const active = focus != null && (s.uid === focus || t.uid === focus);
      const lit = !dimmingBy || (dimmingBy.has(s.uid) && dimmingBy.has(t.uid));
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      const bend = Math.min(dist * 0.12, 26);
      const x1 = s.x + ux * s.r;
      const y1 = s.y + uy * s.r;
      const x2 = t.x - ux * (t.r + 2);
      const y2 = t.y - uy * (t.r + 2);
      const cx = (x1 + x2) / 2 - uy * bend;
      const cy = (y1 + y2) / 2 + ux * bend;

      ctx.globalAlpha = active ? 0.95 : lit ? (link.cross ? 0.8 : 0.55) : 0.08;
      ctx.strokeStyle = link.cross ? '#a855f7' : active ? ink : edgeColor;
      ctx.lineWidth = (active ? 1.8 : link.cross ? 1.5 : 1) / Math.sqrt(k);
      if (link.cross) ctx.setLineDash([5 / k, 4 / k]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cx, cy, x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (!link.cross) {
        // Arrowhead along the curve's end tangent.
        const ax = x2 - cx;
        const ay = y2 - cy;
        const al = Math.hypot(ax, ay) || 1;
        const size = (active ? 7 : 5.5) / Math.sqrt(k);
        const bx = ax / al;
        const by = ay / al;
        ctx.fillStyle = active ? ink : edgeColor;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - bx * size - by * size * 0.55, y2 - by * size + bx * size * 0.55);
        ctx.lineTo(x2 - bx * size + by * size * 0.55, y2 - by * size - bx * size * 0.55);
        ctx.closePath();
        ctx.fill();
      }

      const labelled =
        active && (activeCount <= 5 || (hovered != null && selected != null && hovered !== selected && (s.uid === hovered || t.uid === hovered)));
      if (labelled) {
        const mx = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
        const my = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
        const text = link.cross ? 'same entity' : relationLabel(link.type);
        ctx.globalAlpha = 1;
        ctx.font = `500 ${10.5 / k}px ui-sans-serif, system-ui, sans-serif`;
        const tw = ctx.measureText(text).width;
        const padX = 5 / k;
        const bh = 16 / k;
        ctx.fillStyle = halo;
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = 1 / k;
        ctx.beginPath();
        ctx.roundRect(mx - tw / 2 - padX, my - bh / 2, tw + padX * 2, bh, 8 / k);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, mx, my + 0.5 / k);
        ctx.textBaseline = 'alphabetic';
      }
    }
    ctx.globalAlpha = 1;

    // Nodes
    const hubCut = [...nodes].sort((a, b) => b.degree - a.degree)[Math.min(7, nodes.length - 1)]?.degree ?? 0;
    const labelQueue: { n: SimNode; strong: boolean }[] = [];

    for (const n of nodes) {
      if (n.x == null || n.y == null) continue;
      const style = typeStyle(n.type);
      const lit = !dimmingBy || dimmingBy.has(n.uid);
      const isSel = n.uid === selected;
      const isHot = highlightSet.has(n.uid);

      ctx.globalAlpha = lit ? 1 : 0.14;

      if (isHot) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 6 + pulse * 6, 0, Math.PI * 2);
        ctx.fillStyle = `${style.color}${Math.round(40 + (1 - pulse) * 40).toString(16).padStart(2, '0')}`;
        ctx.fill();
      }
      if (isSel) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2 / k;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = style.color;
      ctx.fill();
      ctx.lineWidth = multiDoc ? 3 : 1.5;
      ctx.strokeStyle = multiDoc ? graphById.get(n.graph_id)?.color ?? halo : halo;
      ctx.stroke();
      if (multiDoc) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r - 1.5, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = halo;
        ctx.stroke();
      }

      const strong = isSel || isHot || n.uid === hovered || searchSet.has(n.uid);
      const showLabel =
        strong || (focusSet?.has(n.uid) ?? false) || (!dimmingBy && (k > 1.05 || n.degree >= hubCut));
      if (showLabel && lit) labelQueue.push({ n, strong });
    }

    // Labels last so they sit above every node.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const { n, strong } of labelQueue) {
      const size = (strong ? 12.5 : 11.5) / k;
      ctx.font = `${strong ? 650 : 500} ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
      const text = n.label.length > 34 ? `${n.label.slice(0, 32)}…` : n.label;
      const y = (n.y ?? 0) + n.r + 4 / k;
      ctx.globalAlpha = 1;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4 / k;
      ctx.strokeStyle = halo;
      ctx.strokeText(text, n.x ?? 0, y);
      ctx.fillStyle = ink;
      ctx.fillText(text, n.x ?? 0, y);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  };

  useEffect(() => {
    requestDraw();
  }, [hovered, selected, searchSet, highlightSet, layout, requestDraw]);

  // Size the canvas to its box.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const prev = sizeRef.current;
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      // Keep the same world point in the middle.
      viewRef.current = {
        ...viewRef.current,
        x: viewRef.current.x + (rect.width - prev.w) / 2,
        y: viewRef.current.y + (rect.height - prev.h) / 2,
      };
      drawRef.current();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [data]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // ------------------------------------------------------------ pointer input

  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { k, x, y } = viewRef.current;
    return { x: (clientX - rect.left - x) / k, y: (clientY - rect.top - y) / k };
  };

  const nodeAt = (clientX: number, clientY: number) => {
    const p = toWorld(clientX, clientY);
    const slop = 4 / viewRef.current.k;
    let best: SimNode | null = null;
    let bestDist = Infinity;
    for (const n of nodesRef.current) {
      const d = Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y);
      if (d <= n.r + slop && d < bestDist) {
        best = n;
        bestDist = d;
      }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const hit = nodeAt(e.clientX, e.clientY);
    dragRef.current = {
      mode: hit ? 'node' : 'pan',
      uid: hit?.uid,
      startX: e.clientX,
      startY: e.clientY,
      viewX: viewRef.current.x,
      viewY: viewRef.current.y,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      const hit = nodeAt(e.clientX, e.clientY);
      const uid = hit?.uid ?? null;
      if (uid !== hovered) setHovered(uid);
      e.currentTarget.style.cursor = hit ? 'pointer' : 'grab';
      return;
    }
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    userMovedRef.current = true;
    e.currentTarget.style.cursor = 'grabbing';

    if (drag.mode === 'pan') {
      viewRef.current = { ...viewRef.current, x: drag.viewX + dx, y: drag.viewY + dy };
      requestDraw();
      return;
    }
    const node = nodesRef.current.find((n) => n.uid === drag.uid);
    if (!node) return;
    const p = toWorld(e.clientX, e.clientY);
    node.fx = p.x;
    node.fy = p.y;
    simRef.current?.alphaTarget(0.25).restart();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    e.currentTarget.style.cursor = 'grab';
    if (!drag) return;
    if (drag.mode === 'node') {
      const node = nodesRef.current.find((n) => n.uid === drag.uid);
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      simRef.current?.alphaTarget(0);
    }
    if (!drag.moved) {
      if (drag.mode === 'node' && drag.uid) select(drag.uid === selected ? null : drag.uid);
      else select(null);
    }
  };

  const zoomBy = (factor: number, cx?: number, cy?: number) => {
    const { w, h } = sizeRef.current;
    const px = cx ?? w / 2;
    const py = cy ?? h / 2;
    const v = viewRef.current;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
    userMovedRef.current = true;
    viewRef.current = { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
    requestDraw();
  };

  // React's onWheel is passive, so attach a real listener to be able to preventDefault.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018));
      zoomBy(factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ inspector data

  const selectedNode = selected ? (data?.nodes.find((n) => n.uid === selected) ?? null) : null;
  const connections = useMemo(() => {
    if (!selectedNode || !data) return [];
    const byUid = new Map(data.nodes.map((n) => [n.uid, n]));
    const groups = new Map<string, { dir: 'out' | 'in' | 'same'; node: GraphNode }[]>();
    for (const e of data.edges) {
      if (e.source !== selectedNode.uid && e.target !== selectedNode.uid) continue;
      const out = e.source === selectedNode.uid;
      const other = byUid.get(out ? e.target : e.source);
      if (!other) continue;
      const label = e.cross ? 'Same entity in another document' : relationLabel(e.type);
      const list = groups.get(label) ?? [];
      list.push({ dir: e.cross ? 'same' : out ? 'out' : 'in', node: other });
      groups.set(label, list);
    }
    return [...groups.entries()];
  }, [selectedNode, data]);

  // ------------------------------------------------------------ render

  const shownDocs = graphIds.map((id) => graphById.get(id)).filter(Boolean) as GraphInfo[];
  const empty = data && data.nodes.length === 0;

  return (
    <div className={`gx ${fullscreen ? 'gx-fullscreen' : ''}`}>
      <div className="gx-stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="gx-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => !dragRef.current && setHovered(null)}
          onDoubleClick={(e) => {
            const hit = nodeAt(e.clientX, e.clientY);
            if (hit) {
              setSelected(hit.uid);
              onSelectNode?.(hit.uid);
              centerOn(hit.uid, Math.min(viewRef.current.k * 1.6, 3));
            }
          }}
          aria-label="Knowledge graph canvas"
        />

        {/* Top-left: title + documents legend */}
        <div className="gx-card gx-legend">
          <button type="button" className="gx-legend-head" onClick={() => setLegendOpen((v) => !v)}>
            <span className="gx-title">{title}</span>
            <span className="gx-meta">
              {visible.nodes.length} nodes · {visible.edges.length} links
            </span>
            <span className={`gx-chevron ${legendOpen ? 'open' : ''}`} aria-hidden>
              ▾
            </span>
          </button>
          {legendOpen && shownDocs.length > 0 && (
            <ul className="gx-docs">
              {shownDocs.map((doc) => {
                const hidden = hiddenGraphs.has(doc.id);
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      className={`gx-doc ${hidden ? 'is-off' : ''}`}
                      onClick={() =>
                        setHiddenGraphs((prev) => {
                          const next = new Set(prev);
                          if (next.has(doc.id)) next.delete(doc.id);
                          else next.add(doc.id);
                          return next;
                        })
                      }
                      title={hidden ? 'Show this document' : 'Hide this document'}
                    >
                      <span className="gx-swatch" style={{ background: doc.color }} />
                      <span className="gx-doc-name">{doc.name}</span>
                      <span className="gx-count">{stats.graphCounts.get(doc.id) ?? 0}</span>
                    </button>
                  </li>
                );
              })}
              {multiDoc && stats.bridges > 0 && (
                <li className="gx-bridges">
                  <span className="gx-dash" /> {stats.bridges} shared {stats.bridges === 1 ? 'entity' : 'entities'}
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Top-right: search, layout, fullscreen */}
        <div className="gx-toolbar">
          <div className="gx-search">
            <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden>
              <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="m14 14 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchMatches[0]) select(searchMatches[0].uid, true);
                if (e.key === 'Escape') setQuery('');
              }}
              placeholder="Find a node"
              aria-label="Find a node"
            />
            {query && (
              <button type="button" className="gx-icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
                ✕
              </button>
            )}
            {query && (
              <div className="gx-results">
                {searchMatches.length === 0 && <div className="gx-result-empty">No matches</div>}
                {searchMatches.map((n) => (
                  <button
                    type="button"
                    key={n.uid}
                    className="gx-result"
                    onClick={() => select(n.uid, true)}
                  >
                    <span className="gx-swatch" style={{ background: typeStyle(n.type).color }} />
                    <span className="gx-result-label">{n.label}</span>
                    <span className="gx-result-type">{typeStyle(n.type).label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="gx-segment" role="tablist" aria-label="Layout">
            {LAYOUTS.filter((l) => l.id !== 'documents' || multiDoc).map((l) => (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={layout === l.id}
                className={layout === l.id ? 'is-on' : ''}
                onClick={() => {
                  userMovedRef.current = false;
                  setLayout(l.id);
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="gx-card gx-icon-btn gx-square"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {fullscreen ? (
              <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden>
                <path d="M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden>
                <path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            )}
          </button>
        </div>

        {/* Bottom-left: type filters */}
        {stats.types.length > 0 && (
          <div className="gx-card gx-types">
            {stats.types.map(([type, count]) => {
              const style = typeStyle(type);
              const off = hiddenTypes.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  className={`gx-type ${off ? 'is-off' : ''}`}
                  onClick={() =>
                    setHiddenTypes((prev) => {
                      const next = new Set(prev);
                      if (next.has(type)) next.delete(type);
                      else next.add(type);
                      return next;
                    })
                  }
                  onDoubleClick={() =>
                    setHiddenTypes(new Set(stats.types.map(([t]) => t).filter((t) => t !== type)))
                  }
                  title={`${off ? 'Show' : 'Hide'} ${style.label} nodes · double-click to show only these`}
                >
                  <span className="gx-swatch" style={{ background: style.color }} />
                  {style.label}
                  <span className="gx-count">{count}</span>
                </button>
              );
            })}
            {hiddenTypes.size > 0 && (
              <button type="button" className="gx-type gx-reset" onClick={() => setHiddenTypes(new Set())}>
                Show all
              </button>
            )}
          </div>
        )}

        {/* Bottom-right: zoom */}
        <div className="gx-card gx-zoom">
          <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in">
            +
          </button>
          <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out" title="Zoom out">
            −
          </button>
          <button
            type="button"
            onClick={() => {
              userMovedRef.current = false;
              fit(true);
            }}
            aria-label="Fit to screen"
            title="Fit to screen"
          >
            <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden>
              <rect x="4" y="4" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="10" cy="10" r="1.6" fill="currentColor" />
            </svg>
          </button>
        </div>

        {/* States */}
        {graphIds.length === 0 && (
          <div className="gx-empty">
            <strong>No documents selected</strong>
            <p>Pick one or more document graphs to see them here.</p>
          </div>
        )}
        {graphIds.length > 0 && empty && !loading && (
          <div className="gx-empty">
            <strong>Nothing to draw</strong>
            <p>These documents have no extracted nodes yet.</p>
          </div>
        )}
        {error && (
          <div className="gx-empty gx-error">
            <strong>Could not load the graph</strong>
            <p>{error}</p>
            <button type="button" className="btn btn-sm" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}
        {loading && <div className="gx-loading">Loading graph…</div>}

        {/* Inspector */}
        <aside className={`gx-inspector ${selectedNode ? 'is-open' : ''}`} aria-hidden={!selectedNode}>
          {selectedNode && (
            <>
              <div className="gx-insp-head">
                <span
                  className="gx-type-badge"
                  style={{ color: typeStyle(selectedNode.type).color, borderColor: `${typeStyle(selectedNode.type).color}55` }}
                >
                  {typeStyle(selectedNode.type).icon} {typeStyle(selectedNode.type).label}
                </span>
                <button type="button" className="gx-icon-btn" onClick={() => select(null)} aria-label="Close details">
                  ✕
                </button>
              </div>
              <h3 className="gx-insp-title">{selectedNode.label}</h3>
              {graphById.get(selectedNode.graph_id) && (
                <div className="gx-insp-doc">
                  <span className="gx-swatch" style={{ background: graphById.get(selectedNode.graph_id)!.color }} />
                  {graphById.get(selectedNode.graph_id)!.name}
                </div>
              )}
              {selectedNode.text && <p className="gx-insp-text">{selectedNode.text}</p>}

              <div className="gx-insp-actions">
                {onAskAbout && (
                  <button type="button" className="btn btn-sm" onClick={() => onAskAbout(selectedNode)}>
                    Ask about this
                  </button>
                )}
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => centerOn(selectedNode.uid)}>
                  Center
                </button>
              </div>

              <div className="gx-insp-section">
                <span className="gx-insp-label">
                  Connections · {stats.adjacency.get(selectedNode.uid)?.size ?? 0}
                </span>
                {connections.length === 0 && <p className="gx-muted">No connections.</p>}
                {connections.map(([rel, items]) => (
                  <div key={rel} className="gx-rel">
                    <div className="gx-rel-name">{rel}</div>
                    {items.map(({ dir, node }) => (
                      <button
                        type="button"
                        key={`${rel}-${node.uid}`}
                        className="gx-rel-item"
                        onClick={() => select(node.uid, true)}
                      >
                        <span className="gx-dir">{dir === 'out' ? '→' : dir === 'in' ? '←' : '≡'}</span>
                        <span className="gx-swatch" style={{ background: typeStyle(node.type).color }} />
                        <span className="gx-rel-label">{node.label}</span>
                        {multiDoc && (
                          <span
                            className="gx-doc-dot"
                            style={{ background: graphById.get(node.graph_id)?.color }}
                            title={graphById.get(node.graph_id)?.name}
                          />
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
