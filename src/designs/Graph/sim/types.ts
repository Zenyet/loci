import type { GroupColors } from '../../../types';
/**
 * Public surface of the graph physics layer.
 *
 * The simulation is a handrolled 2D force solver (`Engine` + Barnes–Hut
 * charge) wrapped in a React hook (`useGraphSimCustom`). This module only
 * exposes the types; consumers import the hook through
 * `useGraphSim.ts`.
 */

import type { MutableRefObject } from 'react';
import type { GraphEdge, GraphItem, GraphNode, Group, PinsMap } from '../../../types';

/**
 * Minimal simulation surface the render loop reads each rAF tick.
 *
 * `alpha()` returns the current heat; the loop tick-advances the sim only
 * while it's above a small threshold. `tick()` advances physics by one step.
 */
export interface SimulationLike {
  alpha(): number;
  tick(): void;
}

export interface SimParams {
  bookmarks: GraphItem[];
  groups: Group[];
  edges: GraphEdge[];
  pins: PinsMap;
  /** User-set hue overrides keyed by folder id. Unset folders fall back to
   *  the deterministic hash hue. */
  hueOverrides?: GroupColors;
}

export interface GraphSim {
  nodesRef: MutableRefObject<GraphNode[]>;
  simulationRef: MutableRefObject<SimulationLike | null>;
  /** Drag a node and its visible neighbors together, preserving their offsets.
   *  Already pinned neighbors stay in place. */
  startDrag: (id: string, wx: number, wy: number, relatedIds?: ReadonlySet<string>) => void;
  dragTo: (wx: number, wy: number) => void;
  endDrag: (pinInsteadOfRelease: boolean) => { id: string; x: number; y: number } | null;
  /** Kick the physics (alpha) after a topology change. */
  reheat: (alpha?: number) => void;
  /** Return a live node by id without scanning the simulation. */
  findById: (id: string) => GraphNode | null;
}
