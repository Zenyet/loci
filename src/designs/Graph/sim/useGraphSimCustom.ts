/**
 * React hook wrapping the physics `Engine`.
 *
 * The engine is long-lived — we build it once per mount and keep feeding
 * it new topologies as props change. That way node identity (and therefore
 * position/velocity) survives across topology rebuilds, which is what
 * keeps the layout visually stable when a user adds or removes bookmarks.
 *
 * The hook exposes the same `GraphSim` surface that `GraphCanvas`
 * consumes: a refs-based snapshot of nodes, a `SimulationLike` for the
 * rAF loop, and drag helpers.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { GraphNode } from '../../../types';
import { folderHue } from '../folderHue';
import { collectionPositions } from './collectionLayout';
import { Engine, type EngineLink } from './engine';
import type { GraphSim, SimParams, SimulationLike } from './types';

export function radiusFor(count: number, kind: GraphNode['nodeKind']): number {
  if (kind === 'group') return 30 + Math.min(10, Math.sqrt(Math.max(0, count)) * 1.2);
  return 24 + Math.min(8, Math.sqrt(Math.max(0, count)) * 0.7);
}

export function useGraphSimCustom({
  bookmarks,
  edges,
  pins,
  hueOverrides,
}: SimParams): GraphSim {
  const nodesRef = useRef<GraphNode[]>([]);
  const engineRef = useRef<Engine | null>(null);
  const simulationRef = useRef<SimulationLike | null>(null);
  const draggingRef = useRef<string | null>(null);

  // Engine is allocated once per mount; topology and node arrays are swapped
  // via `setTopology` on each rebuild.
  if (engineRef.current === null) {
    // Every visible item is a peer in this collection. Folder membership only
    // controls navigation/color, never a separate attraction point on a ring.
    engineRef.current = new Engine({ groupRadius: 0, groupStrength: 0.032 });
    simulationRef.current = engineRef.current;
  }

  // Latest hue overrides — read at rebuild time without being a dep.
  // Keeps expensive topology rebuilds off the hot path of the hue slider;
  // live hue changes are instead mutated in place by the effect below.
  const hueOverridesRef = useRef(hueOverrides);

  useEffect(() => {
    hueOverridesRef.current = hueOverrides;
    for (const n of nodesRef.current) {
      n.groupHue = hueOverrides?.[n.parentId] ?? folderHue(n.parentId);
    }
  }, [hueOverrides]);

  useEffect(() => {
    const engine = engineRef.current!;
    const prev = new Map(nodesRef.current.map((n) => [n.id, n] as const));
    const positions = collectionPositions(bookmarks);

    const nodes: GraphNode[] = bookmarks.map((b) => {
      const prior = prev.get(b.id);
      const pin = pins[b.id];
      const hueKey = b.nodeKind === 'group' ? b.groupId ?? b.parentId : b.parentId;
      const position = positions.get(b.id)!;
      return {
        ...b,
        x: pin?.x ?? prior?.x ?? position.x,
        y: pin?.y ?? prior?.y ?? position.y,
        vx: prior?.vx ?? 0,
        vy: prior?.vy ?? 0,
        fx: pin?.x ?? null,
        fy: pin?.y ?? null,
        radius: radiusFor(b.nodeKind === 'group' ? b.bookmarkCount ?? 0 : b.visits, b.nodeKind),
        groupHue: hueOverridesRef.current?.[hueKey] ?? folderHue(hueKey),
      };
    });

    // Edge filter mirrors d3-force's behaviour: silently drop dangling links.
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const links: EngineLink[] = [];
    for (const e of edges) {
      const source = byId.get(e.from);
      const target = byId.get(e.to);
      if (source && target) links.push({ source, target });
    }

    engine.setTopology(nodes, links, new Map());
    engine.alpha(1);

    nodesRef.current = nodes;

    return () => {
      // Don't destroy the engine — we reuse it across topology changes.
      // Just cool it so stray ticks don't run against swapped-out nodes.
      engine.stop();
    };
  }, [bookmarks, edges, pins]);

  const reheat = useCallback((alpha = 0.4) => {
    const engine = engineRef.current;
    if (engine) engine.alpha(alpha);
  }, []);

  const startDrag = useCallback((id: string, wx: number, wy: number) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;
    draggingRef.current = id;
    node.fx = wx;
    node.fy = wy;
    const engine = engineRef.current;
    if (engine) {
      engine.alphaTarget(0.3);
      if (engine.alpha() < 0.3) engine.alpha(0.3);
    }
  }, []);

  const dragTo = useCallback((wx: number, wy: number) => {
    const id = draggingRef.current;
    if (!id) return;
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;
    node.fx = wx;
    node.fy = wy;
  }, []);

  const endDrag = useCallback((pinInsteadOfRelease: boolean) => {
    const id = draggingRef.current;
    if (!id) return null;
    draggingRef.current = null;
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return null;
    const pos = { id, x: node.fx ?? node.x, y: node.fy ?? node.y };
    if (!pinInsteadOfRelease) {
      node.fx = null;
      node.fy = null;
    }
    const engine = engineRef.current;
    if (engine) engine.alphaTarget(0);
    return pos;
  }, []);

  const findById = useCallback(
    (id: string) => nodesRef.current.find((n) => n.id === id) ?? null,
    []
  );

  return useMemo(
    () => ({
      nodesRef,
      simulationRef,
      startDrag,
      dragTo,
      endDrag,
      reheat,
      findById,
    }),
    [startDrag, dragTo, endDrag, reheat, findById]
  );
}
