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

interface DragMember {
  node: GraphNode;
  dx: number;
  dy: number;
  fx: number | null;
  fy: number | null;
}

interface DragSession {
  node: GraphNode;
  members: DragMember[];
}

function moveDrag(session: DragSession, wx: number, wy: number): void {
  for (const { node, dx, dy } of session.members) {
    node.x = node.fx = wx + dx;
    node.y = node.fy = wy + dy;
    node.vx = node.vy = 0;
  }
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
  const draggingRef = useRef<DragSession | null>(null);
  const nodeByIdRef = useRef(new Map<string, GraphNode>());

  const endDrag = useCallback((pinInsteadOfRelease: boolean) => {
    const session = draggingRef.current;
    if (!session) return null;
    draggingRef.current = null;
    const node = session.node;
    const pos = { id: node.id, x: node.fx ?? node.x, y: node.fy ?? node.y };
    for (const member of session.members) {
      if (pinInsteadOfRelease && member.node === node) continue;
      member.node.fx = member.fx;
      member.node.fy = member.fy;
      if (member.fx !== null) member.node.x = member.fx;
      if (member.fy !== null) member.node.y = member.fy;
      member.node.vx = member.node.vy = 0;
    }
    engineRef.current?.alphaTarget(0);
    return pos;
  }, []);

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
      const hueKey = n.nodeKind === 'group' ? n.groupId ?? n.parentId : n.parentId;
      n.groupHue = hueOverrides?.[hueKey] ?? folderHue(hueKey);
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
    nodeByIdRef.current = byId;

    return () => {
      endDrag(false);
      // Don't destroy the engine — we reuse it across topology changes.
      // Just cool it so stray ticks don't run against swapped-out nodes.
      engine.stop();
    };
  }, [bookmarks, edges, pins, endDrag]);

  const reheat = useCallback((alpha = 0.4) => {
    const engine = engineRef.current;
    if (engine) engine.alpha(alpha);
  }, []);

  const startDrag = useCallback((id: string, wx: number, wy: number, relatedIds?: ReadonlySet<string>) => {
    endDrag(false);
    const node = nodeByIdRef.current.get(id);
    if (!node) return;
    const members: DragMember[] = [{ node, dx: 0, dy: 0, fx: node.fx ?? null, fy: node.fy ?? null }];
    // Snapshot once per gesture. Pointer moves only visit these members,
    // with no topology traversal, node searches, or React state updates.
    for (const relatedId of relatedIds ?? []) {
      if (relatedId === id) continue;
      const related = nodeByIdRef.current.get(relatedId);
      if (!related || related.fx != null || related.fy != null) continue;
      members.push({ node: related, dx: related.x - node.x, dy: related.y - node.y, fx: null, fy: null });
    }
    const session = { node, members };
    draggingRef.current = session;
    moveDrag(session, wx, wy);
    const engine = engineRef.current;
    if (engine) {
      // Pointer movement supplies heat. Holding a node still must eventually
      // let the simulation sleep instead of running forever at alphaTarget .3.
      engine.alphaTarget(0);
      if (engine.alpha() < 0.3) engine.alpha(0.3);
    }
  }, [endDrag]);

  const dragTo = useCallback((wx: number, wy: number) => {
    const session = draggingRef.current;
    if (!session || (session.node.fx === wx && session.node.fy === wy)) return;
    moveDrag(session, wx, wy);
    const engine = engineRef.current;
    if (engine && engine.alpha() < 0.3) engine.alpha(0.3);
  }, []);

  const findById = useCallback(
    (id: string) => nodeByIdRef.current.get(id) ?? null,
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
