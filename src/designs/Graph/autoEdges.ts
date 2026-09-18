import type { GraphEdge, GraphItem } from '../../types';
import { edgeId } from './edges';
import { clustersForHost, hostOf } from './relationSuggest';

/** Two-level public suffixes we special-case so `baseDomain` keeps eTLD+1. */
const MULTI_TLDS = new Set([
  'co.uk', 'org.uk', 'com.cn', 'net.cn', 'com.hk',
  'com.tw', 'co.jp', 'co.kr', 'com.au', 'com.br',
]);

/**
 * Approximate registrable domain (eTLD+1). Not a full public-suffix list —
 * a small curated set of common two-level TLDs is enough for grouping a
 * handful of bookmarks without pulling in a dependency.
 */
export function baseDomain(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_TLDS.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

interface Located {
  node: GraphItem;
  host: string;
}

/** Connect every member to the highest-visit hub; emit deduped 'auto' edges. */
function star(members: Located[], seen: Set<string>, out: GraphEdge[]): void {
  if (members.length < 2) return;
  const sorted = [...members].sort(
    (a, b) => b.node.visits - a.node.visits || (a.node.id < b.node.id ? -1 : 1)
  );
  const hub = sorted[0]!.node;
  for (let i = 1; i < sorted.length; i++) {
    const to = sorted[i]!.node;
    const id = edgeId(hub.id, to.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, from: hub.id, to: to.id, kind: 'auto' });
  }
}

/**
 * Derive display-only relationship edges from the current bookmark set:
 *  - same host cluster (HOST_CLUSTERS) → star to the cluster's busiest site
 *  - same registrable domain → star to that domain's busiest site
 * Pairs already linked by a manual edge are skipped, and the two rules share
 * one dedupe set so a pair is never emitted twice.
 */
export function computeAutoEdges(
  nodes: GraphItem[],
  manualEdges: GraphEdge[]
): GraphEdge[] {
  const located: Located[] = [];
  for (const node of nodes) {
    if (node.nodeKind === 'group') continue;
    const host = hostOf(node.url);
    if (!host || !host.includes('.')) continue;
    located.push({ node, host });
  }

  const seen = new Set<string>();
  for (const e of manualEdges) seen.add(edgeId(e.from, e.to)); // never shadow a manual link

  const out: GraphEdge[] = [];

  // Rule 1: same host cluster.
  const byCluster = new Map<string, Located[]>();
  for (const l of located) {
    const cluster = clustersForHost(l.host)[0];
    if (!cluster) continue;
    const bucket = byCluster.get(cluster.id);
    if (bucket) bucket.push(l);
    else byCluster.set(cluster.id, [l]);
  }
  for (const members of byCluster.values()) star(members, seen, out);

  // Rule 2: same registrable domain.
  const byDomain = new Map<string, Located[]>();
  for (const l of located) {
    const dom = baseDomain(l.host);
    const bucket = byDomain.get(dom);
    if (bucket) bucket.push(l);
    else byDomain.set(dom, [l]);
  }
  for (const members of byDomain.values()) star(members, seen, out);

  return out;
}
