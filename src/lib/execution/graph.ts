import { nodeSpec, type NodeKind } from "./nodes";

export type WorkflowNode = {
  id: string;
  kind: NodeKind | string;
  label: string;
  position: { x: number; y: number };
  params: Record<string, string | number | boolean | null>;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
};

export type WorkflowGraph = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export const emptyGraph = (): WorkflowGraph => ({ nodes: [], edges: [] });

export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Defensive parse — the graph column is jsonb and may hold anything. */
export function parseGraph(value: unknown): WorkflowGraph {
  if (!value || typeof value !== "object") return emptyGraph();
  const raw = value as Partial<WorkflowGraph>;
  const nodes = Array.isArray(raw.nodes) ? raw.nodes.filter((n) => n && typeof n.id === "string") : [];
  const edges = Array.isArray(raw.edges) ? raw.edges.filter((e) => e && typeof e.id === "string") : [];
  return { nodes, edges };
}

export function createNode(kind: NodeKind, position: { x: number; y: number }): WorkflowNode {
  const spec = nodeSpec(kind);
  const params: WorkflowNode["params"] = {};
  for (const param of spec.params) {
    params[param.key] = param.type === "boolean" ? false : param.type === "select" ? (param.options?.[0] ?? "") : "";
  }
  return { id: uid(kind), kind, label: spec.label, position, params };
}

/** Duplicates nodes (and the edges strictly between them) with fresh ids. */
export function cloneSelection(graph: WorkflowGraph, nodeIds: string[], offset = 48) {
  const map = new Map<string, string>();
  const nodes = graph.nodes
    .filter((node) => nodeIds.includes(node.id))
    .map((node) => {
      const id = uid(String(node.kind));
      map.set(node.id, id);
      return {
        ...node,
        id,
        params: { ...node.params },
        position: { x: node.position.x + offset, y: node.position.y + offset },
      };
    });
  const edges = graph.edges
    .filter((edge) => map.has(edge.source) && map.has(edge.target))
    .map((edge) => ({
      ...edge,
      id: uid("edge"),
      source: map.get(edge.source)!,
      target: map.get(edge.target)!,
    }));
  return { nodes, edges };
}

/** Kahn topological sort. Returns null when the graph contains a cycle. */
export function topologicalOrder(graph: WorkflowGraph): WorkflowNode[] | null {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (!indegree.has(edge.target) || !outgoing.has(edge.source)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }
  const queue = graph.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  if (order.length !== graph.nodes.length) return null;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return order.map((id) => byId.get(id)!);
}

export function findCycleNodes(graph: WorkflowGraph): string[] {
  if (topologicalOrder(graph)) return [];
  const order = new Set<string>();
  const indegree = new Map<string, number>();
  graph.nodes.forEach((node) => indegree.set(node.id, 0));
  graph.edges.forEach((edge) => indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1));
  const queue = graph.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    order.add(id);
    for (const edge of graph.edges.filter((e) => e.source === id)) {
      const left = (indegree.get(edge.target) ?? 0) - 1;
      indegree.set(edge.target, left);
      if (left === 0) queue.push(edge.target);
    }
  }
  return graph.nodes.filter((node) => !order.has(node.id)).map((node) => node.id);
}
