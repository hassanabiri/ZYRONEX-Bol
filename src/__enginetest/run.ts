import { enqueueExecution, dispatchExecutions, requestCancel } from "@/lib/execution/engine.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WS = "5792e4f5-4010-4d5f-8671-aad33b3f0da1";
const WF = "f7bb51f1-79a4-469b-ae51-bbafcd7d2403";
const graph = {
  nodes: [
    { id: "n1", kind: "start", label: "Start", position: { x: 0, y: 0 }, params: {} },
    { id: "n2", kind: "delay", label: "Wait", position: { x: 0, y: 100 }, params: { seconds: 1 } },
    { id: "n3", kind: "end", label: "End", position: { x: 0, y: 200 }, params: {} },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2" },
    { id: "e2", source: "n2", target: "n3" },
  ],
} as never;

const base = { workspaceId: WS, workflowId: WF, workflowVersion: 1, workflowName: "engine smoke", graph, trigger: "test" };

const a = await enqueueExecution({ ...base, idempotencyKey: "smoke-1" });
const b = await enqueueExecution({ ...base, idempotencyKey: "smoke-1" });
console.log("idempotency same row:", a.id === b.id, a.status, "trace:", a.trace_id);

const r1 = await dispatchExecutions({ max: 2, budgetMs: 20000 });
console.log("dispatch1", r1);

const { data: done } = await supabaseAdmin.from("executions").select("status,progress,duration_ms,error").eq("id", a.id).single();
console.log("execution:", done);
const { data: steps } = await supabaseAdmin.from("execution_steps").select("seq,label,status,duration_ms,trace_id").eq("execution_id", a.id).order("seq");
console.log("steps:", steps);

// cancellation path
const c = await enqueueExecution({ ...base, idempotencyKey: "smoke-cancel" });
await requestCancel(c.id);
const { data: cRow } = await supabaseAdmin.from("executions").select("status,error").eq("id", c.id).single();
console.log("cancel before start:", cRow);

// double-dispatch lease safety
const d = await enqueueExecution({ ...base, idempotencyKey: "smoke-lease" });
const [x, y] = await Promise.all([dispatchExecutions({ max: 3, budgetMs: 20000 }), dispatchExecutions({ max: 3, budgetMs: 20000 })]);
console.log("lease claims:", x.claimed, y.claimed, "one of them is 0 or different rows");
const { data: dRow } = await supabaseAdmin.from("executions").select("status,progress").eq("id", d.id).single();
console.log("leased execution:", dRow);

// cleanup
await supabaseAdmin.from("executions").delete().in("id", [a.id, c.id, d.id]);
