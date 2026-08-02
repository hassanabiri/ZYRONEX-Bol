import { findCycleNodes, type WorkflowGraph } from "./graph";
import { nodeSpec } from "./nodes";

export type ValidationIssue = {
  code:
    | "missing_nodes"
    | "missing_entry"
    | "multiple_entries"
    | "missing_end"
    | "broken_connection"
    | "orphan_node"
    | "circular_reference"
    | "duplicate_id"
    | "missing_configuration"
    | "empty_parameter"
    | "invalid_variable";
  level: "error" | "warning";
  message: string;
  nodeId?: string;
};

export type ValidationReport = {
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  valid: boolean;
};

const VARIABLE_KEYS = ["name", "output_variable"];
const VALID_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Workflow Validation Engine — runs before publishing and on demand in the canvas.
 * Pure function: no I/O, so it can be reused by a future SDK / CLI.
 */
export function validateWorkflow(graph: WorkflowGraph): ValidationReport {
  const issues: ValidationIssue[] = [];
  const push = (issue: ValidationIssue) => issues.push(issue);

  if (graph.nodes.length === 0) {
    push({ code: "missing_nodes", level: "error", message: "The workflow has no nodes." });
    return finalize(issues);
  }

  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) {
      push({ code: "duplicate_id", level: "error", message: `Duplicate node id "${node.id}".`, nodeId: node.id });
    }
    ids.add(node.id);
  }

  const starts = graph.nodes.filter((node) => node.kind === "start");
  if (starts.length === 0)
    push({ code: "missing_entry", level: "error", message: "No Start node — the workflow has no entry point." });
  if (starts.length > 1)
    push({ code: "multiple_entries", level: "error", message: "More than one Start node found." });

  if (!graph.nodes.some((node) => node.kind === "end"))
    push({ code: "missing_end", level: "error", message: "No End node — the workflow never terminates." });

  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      push({
        code: "broken_connection",
        level: "error",
        message: "A connection points to a node that no longer exists.",
      });
    }
  }

  for (const nodeId of findCycleNodes(graph)) {
    push({
      code: "circular_reference",
      level: "error",
      message: `Circular reference detected around "${label(graph, nodeId)}".`,
      nodeId,
    });
  }

  for (const node of graph.nodes) {
    const spec = nodeSpec(String(node.kind));
    const incoming = graph.edges.filter((edge) => edge.target === node.id);
    const outgoing = graph.edges.filter((edge) => edge.source === node.id);

    if (spec.inputs === 1 && incoming.length === 0)
      push({ code: "orphan_node", level: "error", message: `"${node.label}" is not connected to any previous node.`, nodeId: node.id });
    if (spec.inputs === 0 && incoming.length > 0)
      push({ code: "broken_connection", level: "error", message: `"${node.label}" is an entry node and cannot have inputs.`, nodeId: node.id });
    if (spec.outputs.length > 0 && outgoing.length === 0)
      push({ code: "orphan_node", level: "warning", message: `"${node.label}" has no outgoing connection.`, nodeId: node.id });
    if (spec.outputs.length > 1) {
      for (const handle of spec.outputs) {
        if (!outgoing.some((edge) => (edge.sourceHandle ?? "out") === handle))
          push({
            code: "broken_connection",
            level: "warning",
            message: `"${node.label}" branch "${handle}" is not connected.`,
            nodeId: node.id,
          });
      }
    }

    if (spec.params.length && !node.params)
      push({ code: "missing_configuration", level: "error", message: `"${node.label}" has no configuration.`, nodeId: node.id });

    for (const param of spec.params) {
      const value = node.params?.[param.key];
      const empty = value === undefined || value === null || String(value).trim() === "";
      if (param.required && empty)
        push({
          code: "empty_parameter",
          level: "error",
          message: `"${node.label}" is missing the required field "${param.label}".`,
          nodeId: node.id,
        });
      if (VARIABLE_KEYS.includes(param.key) && !empty && !VALID_VARIABLE.test(String(value)))
        push({
          code: "invalid_variable",
          level: "error",
          message: `"${node.label}" uses an invalid variable name "${String(value)}".`,
          nodeId: node.id,
        });
    }
  }

  return finalize(issues);
}

function label(graph: WorkflowGraph, nodeId: string) {
  return graph.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function finalize(issues: ValidationIssue[]): ValidationReport {
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  return { issues, errors, warnings, valid: errors.length === 0 };
}
