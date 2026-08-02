import {
  Bell,
  Bot,
  Braces,
  CircleDot,
  Clock,
  Code2,
  Database,
  Flag,
  GitBranch,
  Globe,
  ListRestart,
  MessageSquare,
  Puzzle,
  Repeat,
  Save,
  Search,
  ShieldQuestion,
  Sparkles,
  UserCheck,
  Webhook,
  type LucideIcon,
} from "lucide-react";

/**
 * Node catalogue for the Execution Engine.
 * Every node in the canvas is rendered by one shared base component and is fully
 * described by its spec below — adding a node type never requires new UI code.
 */
export const NODE_KINDS = [
  "start",
  "end",
  "ai_prompt",
  "decision",
  "condition",
  "knowledge_search",
  "memory_read",
  "memory_write",
  "variable",
  "delay",
  "loop",
  "http_request",
  "webhook",
  "integration",
  "notification",
  "voice",
  "human_approval",
  "custom_function",
  "future",
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export type NodeCategory = "flow" | "ai" | "data" | "integration" | "human" | "custom";

export type NodeParam = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "boolean" | "select";
  options?: string[];
  required?: boolean;
  placeholder?: string;
};

export type NodeSpec = {
  kind: NodeKind;
  label: string;
  description: string;
  category: NodeCategory;
  icon: LucideIcon;
  accent: string;
  /** Number of incoming connections allowed (0 = entry node). */
  inputs: 0 | 1;
  /** Named outgoing handles. Empty array = terminal node. */
  outputs: string[];
  params: NodeParam[];
};

const spec = (value: NodeSpec) => value;

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  start: spec({
    kind: "start",
    label: "Start",
    description: "Entry point of the workflow.",
    category: "flow",
    icon: CircleDot,
    accent: "oklch(0.72 0.13 210)",
    inputs: 0,
    outputs: ["out"],
    params: [
      {
        key: "trigger",
        label: "Trigger",
        type: "select",
        options: ["manual", "scheduled", "webhook", "event"],
        required: true,
      },
    ],
  }),
  end: spec({
    kind: "end",
    label: "End",
    description: "Terminates the execution and returns the result.",
    category: "flow",
    icon: Flag,
    accent: "oklch(0.66 0.19 15)",
    inputs: 1,
    outputs: [],
    params: [{ key: "result", label: "Result label", type: "text", placeholder: "completed" }],
  }),
  ai_prompt: spec({
    kind: "ai_prompt",
    label: "AI Prompt",
    description: "Sends a prompt to the assigned AI worker.",
    category: "ai",
    icon: Sparkles,
    accent: "oklch(0.62 0.18 295)",
    inputs: 1,
    outputs: ["out"],
    params: [
      { key: "prompt", label: "Prompt", type: "textarea", required: true },
      { key: "output_variable", label: "Store result in", type: "text", placeholder: "answer" },
    ],
  }),
  decision: spec({
    kind: "decision",
    label: "Decision",
    description: "Branches the flow on a boolean expression.",
    category: "flow",
    icon: GitBranch,
    accent: "oklch(0.78 0.15 75)",
    inputs: 1,
    outputs: ["true", "false"],
    params: [{ key: "expression", label: "Expression", type: "text", required: true, placeholder: "score > 0.8" }],
  }),
  condition: spec({
    kind: "condition",
    label: "Condition",
    description: "Continues only when the condition is met.",
    category: "flow",
    icon: ShieldQuestion,
    accent: "oklch(0.78 0.15 75)",
    inputs: 1,
    outputs: ["out"],
    params: [{ key: "expression", label: "Condition", type: "text", required: true }],
  }),
  knowledge_search: spec({
    kind: "knowledge_search",
    label: "Knowledge Search",
    description: "Retrieves context from the workspace knowledge base.",
    category: "data",
    icon: Search,
    accent: "oklch(0.68 0.15 160)",
    inputs: 1,
    outputs: ["out"],
    params: [
      { key: "query", label: "Query", type: "text", required: true },
      { key: "top_k", label: "Results", type: "number", placeholder: "5" },
    ],
  }),
  memory_read: spec({
    kind: "memory_read",
    label: "Memory Read",
    description: "Loads a value from the worker memory store.",
    category: "data",
    icon: Database,
    accent: "oklch(0.68 0.15 160)",
    inputs: 1,
    outputs: ["out"],
    params: [{ key: "key", label: "Memory key", type: "text", required: true }],
  }),
  memory_write: spec({
    kind: "memory_write",
    label: "Memory Write",
    description: "Persists a value into the worker memory store.",
    category: "data",
    icon: Save,
    accent: "oklch(0.68 0.15 160)",
    inputs: 1,
    outputs: ["out"],
    params: [
      { key: "key", label: "Memory key", type: "text", required: true },
      { key: "value", label: "Value", type: "text", required: true },
    ],
  }),
  variable: spec({
    kind: "variable",
    label: "Variable",
    description: "Declares or updates an execution variable.",
    category: "data",
    icon: Braces,
    accent: "oklch(0.72 0.13 210)",
    inputs: 1,
    outputs: ["out"],
    params: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "value", label: "Value", type: "text" },
    ],
  }),
  delay: spec({
    kind: "delay",
    label: "Delay",
    description: "Waits before continuing the flow.",
    category: "flow",
    icon: Clock,
    accent: "oklch(0.55 0.02 260)",
    inputs: 1,
    outputs: ["out"],
    params: [{ key: "seconds", label: "Seconds", type: "number", required: true, placeholder: "5" }],
  }),
  loop: spec({
    kind: "loop",
    label: "Loop",
    description: "Repeats the connected branch for each item.",
    category: "flow",
    icon: Repeat,
    accent: "oklch(0.55 0.02 260)",
    inputs: 1,
    outputs: ["each", "done"],
    params: [
      { key: "collection", label: "Collection", type: "text", required: true },
      { key: "max_iterations", label: "Max iterations", type: "number", placeholder: "10" },
    ],
  }),
  http_request: spec({
    kind: "http_request",
    label: "HTTP Request",
    description: "Calls an external HTTP endpoint.",
    category: "integration",
    icon: Globe,
    accent: "oklch(0.62 0.18 295)",
    inputs: 1,
    outputs: ["out"],
    params: [
      { key: "method", label: "Method", type: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE"], required: true },
      { key: "url", label: "URL", type: "text", required: true, placeholder: "https://" },
      { key: "body", label: "Body", type: "textarea" },
    ],
  }),
  webhook: spec({
    kind: "webhook",
    label: "Webhook",
    description: "Emits a webhook event to a subscriber.",
    category: "integration",
    icon: Webhook,
    accent: "oklch(0.62 0.18 295)",
    inputs: 1,
    outputs: ["out"],
    params: [{ key: "url", label: "Target URL", type: "text", required: true, placeholder: "https://" }],
  }),
  integration: spec({
    kind: "integration",
    label: "Integration",
    description: "Runs an action on a connected integration.",
    category: "integration",
    icon: Puzzle,
    accent: "oklch(0.62 0.18 295)",
    inputs: 1,
    outputs: ["out"],
    params: [
      { key: "provider", label: "Provider", type: "text", required: true },
      { key: "action", label: "Action", type: "text", required: true },
    ],
  }),
  notification: spec({
    kind: "notification",
    label: "Notification",
    description: "Notifies a channel or a workspace member.",
    category: "integration",
    icon: Bell,
    accent: "oklch(0.78 0.15 75)",
    inputs: 1,
    outputs: ["out"],
    params: [
      { key: "channel", label: "Channel", type: "select", options: ["email", "in-app", "slack", "webhook"], required: true },
      { key: "message", label: "Message", type: "textarea", required: true },
    ],
  }),
  voice: spec({
    kind: "voice",
    label: "Voice",
    description: "Speech synthesis or transcription step.",
    category: "ai",
    icon: MessageSquare,
    accent: "oklch(0.62 0.18 295)",
    inputs: 1,
    outputs: ["out"],
    params: [
      { key: "mode", label: "Mode", type: "select", options: ["speak", "transcribe"], required: true },
      { key: "text", label: "Text / source", type: "textarea" },
    ],
  }),
  human_approval: spec({
    kind: "human_approval",
    label: "Human Approval",
    description: "Pauses until a workspace member approves.",
    category: "human",
    icon: UserCheck,
    accent: "oklch(0.78 0.15 75)",
    inputs: 1,
    outputs: ["approved", "rejected"],
    params: [
      { key: "approver_role", label: "Approver role", type: "select", options: ["owner", "admin", "member"], required: true },
      { key: "instructions", label: "Instructions", type: "textarea" },
    ],
  }),
  custom_function: spec({
    kind: "custom_function",
    label: "Custom Function",
    description: "Executes a registered custom function.",
    category: "custom",
    icon: Code2,
    accent: "oklch(0.55 0.02 260)",
    inputs: 1,
    outputs: ["out"],
    params: [
      { key: "function_name", label: "Function", type: "text", required: true },
      { key: "arguments", label: "Arguments (JSON)", type: "textarea" },
    ],
  }),
  future: spec({
    kind: "future",
    label: "Future Node",
    description: "Reserved placeholder for upcoming node types.",
    category: "custom",
    icon: ListRestart,
    accent: "oklch(0.55 0.02 260)",
    inputs: 1,
    outputs: ["out"],
    params: [{ key: "note", label: "Note", type: "text" }],
  }),
};

export const NODE_CATEGORIES: { value: NodeCategory; label: string; icon: LucideIcon }[] = [
  { value: "flow", label: "Flow control", icon: GitBranch },
  { value: "ai", label: "AI", icon: Bot },
  { value: "data", label: "Data & memory", icon: Database },
  { value: "integration", label: "Integrations", icon: Puzzle },
  { value: "human", label: "Human in the loop", icon: UserCheck },
  { value: "custom", label: "Custom", icon: Code2 },
];

export function nodeSpec(kind: string): NodeSpec {
  return NODE_SPECS[kind as NodeKind] ?? NODE_SPECS.future;
}
