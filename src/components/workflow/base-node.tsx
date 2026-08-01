import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";

import { nodeSpec } from "@/lib/execution/nodes";
import { cn } from "@/lib/utils";

export type BaseNodeData = {
  kind: string;
  label: string;
  paramSummary?: string;
  invalid?: boolean;
  runStatus?: "waiting" | "running" | "completed" | "failed" | "cancelled" | "retrying";
};

/**
 * The single base component every node type inherits from.
 * A node's look and its handles come entirely from its spec.
 */
function BaseNodeComponent({ data, selected }: NodeProps) {
  const node = data as BaseNodeData;
  const spec = nodeSpec(node.kind);
  const Icon = spec.icon;
  const outputs = spec.outputs;

  return (
    <div
      className={cn(
        "min-w-[190px] rounded-xl border bg-card/95 shadow-sm backdrop-blur transition",
        selected && "ring-2 ring-primary",
        node.invalid && "border-destructive",
        node.runStatus === "running" && "animate-pulse border-primary",
        node.runStatus === "completed" && "border-[oklch(0.68_0.15_160)]",
        node.runStatus === "failed" && "border-destructive",
      )}
    >
      {spec.inputs === 1 && (
        <Handle type="target" position={Position.Top} className="!size-2.5 !border-2 !bg-background" />
      )}

      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-background"
          style={{ backgroundColor: spec.accent }}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">{node.label}</p>
          <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{spec.label}</p>
        </div>
      </div>

      <div className="px-3 py-2">
        <p className="line-clamp-2 text-[11px] text-muted-foreground">
          {node.paramSummary || spec.description}
        </p>
      </div>

      {outputs.map((handle, index) => (
        <Handle
          key={handle}
          id={handle}
          type="source"
          position={Position.Bottom}
          className="!size-2.5 !border-2 !bg-background"
          style={
            outputs.length > 1
              ? { left: `${((index + 1) / (outputs.length + 1)) * 100}%` }
              : undefined
          }
        />
      ))}

      {outputs.length > 1 && (
        <div className="flex justify-around border-t px-2 py-1">
          {outputs.map((handle) => (
            <span key={handle} className="text-[10px] text-muted-foreground">
              {handle}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export const BaseNode = memo(BaseNodeComponent);
