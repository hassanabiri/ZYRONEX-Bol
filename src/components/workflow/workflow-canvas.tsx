import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BaseNode, type BaseNodeData } from "./base-node";
import { cloneSelection, uid, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from "@/lib/execution/graph";
import { nodeSpec } from "@/lib/execution/nodes";

const nodeTypes = { base: BaseNode };

function summarize(node: WorkflowNode) {
  const spec = nodeSpec(String(node.kind));
  const first = spec.params.find((param) => {
    const value = node.params?.[param.key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
  if (!first) return "";
  return `${first.label}: ${String(node.params[first.key])}`;
}

function toFlow(graph: WorkflowGraph, invalidIds: string[], stepStatus: Record<string, BaseNodeData["runStatus"]>) {
  const nodes: Node[] = graph.nodes.map((node) => ({
    id: node.id,
    type: "base",
    position: node.position,
    data: {
      kind: String(node.kind),
      label: node.label,
      paramSummary: summarize(node),
      invalid: invalidIds.includes(node.id),
      ...(stepStatus[node.id] ? { runStatus: stepStatus[node.id] } : {}),
    } as unknown as Record<string, unknown>,
  }));
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    ...(edge.sourceHandle && edge.sourceHandle !== "out" ? { label: edge.sourceHandle } : {}),
    animated: stepStatus[edge.target] === "running",
  }));
  return { nodes, edges };
}

export type WorkflowCanvasHandle = {
  addNode: (node: WorkflowNode) => void;
};

type Props = {
  value: WorkflowGraph;
  onChange: (graph: WorkflowGraph) => void;
  onSelect: (nodeId: string | null) => void;
  selectedId: string | null;
  invalidIds?: string[];
  stepStatus?: Record<string, BaseNodeData["runStatus"]>;
  readOnly?: boolean;
  snapToGrid?: boolean;
};

function CanvasInner({
  value,
  onChange,
  onSelect,
  selectedId,
  invalidIds = [],
  stepStatus = {},
  readOnly,
  snapToGrid = true,
}: Props) {
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const clipboard = useRef<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] } | null>(null);
  const [{ nodes, edges }, setFlowState] = useState(() => toFlow(value, invalidIds, stepStatus));
  const lastEmitted = useRef<string>(JSON.stringify(value));

  // Re-sync when the graph is replaced from the outside (undo, restore, load).
  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (serialized === lastEmitted.current) {
      setFlowState((current) => {
        const next = toFlow(value, invalidIds, stepStatus);
        return {
          nodes: next.nodes.map((node) => {
            const selected = current.nodes.find((existing) => existing.id === node.id)?.selected;
            return selected === undefined ? node : { ...node, selected };
          }),
          edges: next.edges,
        };
      });
      return;
    }
    lastEmitted.current = serialized;
    setFlowState(toFlow(value, invalidIds, stepStatus));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, JSON.stringify(invalidIds), JSON.stringify(stepStatus)]);

  const emit = useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => {
      const graph: WorkflowGraph = {
        nodes: nextNodes.map((node) => {
          const previous = value.nodes.find((item) => item.id === node.id);
          return {
            id: node.id,
            kind: (node.data as BaseNodeData).kind,
            label: (node.data as BaseNodeData).label,
            position: node.position,
            params: previous?.params ?? {},
          };
        }),
        edges: nextEdges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? "out",
        })),
      };
      lastEmitted.current = JSON.stringify(graph);
      onChange(graph);
    },
    [onChange, value.nodes],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setFlowState((current) => {
        const next = applyNodeChanges(changes, current.nodes);
        const structural = changes.some(
          (change) =>
            change.type === "remove" ||
            change.type === "add" ||
            (change.type === "position" && change.dragging === false),
        );
        if (structural && !readOnly) emit(next, current.edges);
        return { nodes: next, edges: current.edges };
      });
    },
    [emit, readOnly],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setFlowState((current) => {
        const next = applyEdgeChanges(changes, current.edges);
        if (changes.some((change) => change.type === "remove") && !readOnly) emit(current.nodes, next);
        return { nodes: current.nodes, edges: next };
      });
    },
    [emit, readOnly],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      setFlowState((current) => {
        const next = addEdge({ ...connection, id: uid("edge") }, current.edges);
        emit(current.nodes, next);
        return { nodes: current.nodes, edges: next };
      });
    },
    [emit, readOnly],
  );

  // Copy / paste / duplicate on the current selection.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const selectedIds = nodes.filter((node) => node.selected).map((node) => node.id);

      if (event.key === "c" && selectedIds.length) {
        clipboard.current = cloneSelection(value, selectedIds, 0);
        event.preventDefault();
      }
      if (event.key === "d" && selectedIds.length) {
        event.preventDefault();
        const copy = cloneSelection(value, selectedIds);
        onChange({ nodes: [...value.nodes, ...copy.nodes], edges: [...value.edges, ...copy.edges] });
      }
      if (event.key === "v" && clipboard.current) {
        event.preventDefault();
        const pasted = {
          nodes: clipboard.current.nodes.map((node) => ({
            ...node,
            id: uid(String(node.kind)),
            position: { x: node.position.x + 60, y: node.position.y + 60 },
          })),
          edges: [] as WorkflowEdge[],
        };
        onChange({ nodes: [...value.nodes, ...pasted.nodes], edges: value.edges });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodes, value, onChange, readOnly]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (readOnly) return;
      const kind = event.dataTransfer.getData("application/zyronex-node");
      if (!kind) return;
      const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      window.dispatchEvent(new CustomEvent("zyronex:add-node", { detail: { kind, position } }));
    },
    [flow, readOnly],
  );

  const selectedNodes = useMemo(
    () => nodes.map((node) => (node.id === selectedId ? { ...node, selected: true } : node)),
    [nodes, selectedId],
  );

  return (
    <div ref={wrapper} className="size-full" onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
      <ReactFlow
        nodes={selectedNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        selectionOnDrag
        panOnDrag={[1, 2]}
        snapToGrid={snapToGrid}
        snapGrid={[16, 16]}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-surface"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <MiniMap pannable zoomable className="!bg-card" />
        <Controls showInteractive={false} className="!bg-card !text-foreground" />
      </ReactFlow>
    </div>
  );
}

export function WorkflowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export default WorkflowCanvas;
