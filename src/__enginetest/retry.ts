import { enqueueExecution, dispatchExecutions, registerNodeHandler } from "@/lib/execution/engine.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WS = "5792e4f5-4010-4d5f-8671-aad33b3f0da1";
const WF = "f7bb51f1-79a4-469b-ae51-bbafcd7d2403";
let calls = 0;
registerNodeHandler("delay", async () => { calls++; if (calls < 3) throw new Error("boom"); return {}; });

const graph = { nodes: [
  { id: "n1", kind: "start", label: "Start", position: { x: 0, y: 0 }, params: { trigger: "manual" } },
  { id: "n2", kind: "delay", label: "Flaky", position: { x: 0, y: 100 }, params: { seconds: 0 } },
  { id: "n3", kind: "end", label: "End", position: { x: 0, y: 200 }, params: {} },
], edges: [ { id: "e1", source: "n1", target: "n2" }, { id: "e2", source: "n2", target: "n3" } ] } as never;

const ok = await enqueueExecution({ workspaceId: WS, workflowId: WF, workflowVersion: 1, workflowName: "retry test", graph, trigger: "test", maxAttempts: 3, idempotencyKey: `retry-${Date.now()}` });
console.log("retry dispatch:", await dispatchExecutions({ budgetMs: 20000 }), "handler calls:", calls);
console.log("row:", (await supabaseAdmin.from("executions").select("status,attempt,error").eq("id", ok.id).single()).data);

// timeout path
const slow = await enqueueExecution({ workspaceId: WS, workflowId: WF, workflowVersion: 1, workflowName: "timeout test", graph: { nodes: [
  { id: "n1", kind: "start", label: "Start", position: {x:0,y:0}, params: { trigger: "manual" } },
  { id: "n2", kind: "human_approval", label: "Slow", position: {x:0,y:100}, params: { role: "admin", approver_role: "admin" } },
  { id: "n3", kind: "end", label: "End", position: {x:0,y:200}, params: {} },
], edges: [{id:"e1",source:"n1",target:"n2"},{id:"e2",source:"n2",target:"n3"}] } as never, trigger: "test", timeoutSeconds: 5, idempotencyKey: `to-${Date.now()}` });
registerNodeHandler("human_approval", async ({ signal }) => { await new Promise((_, rej) => { const t = setTimeout(() => rej(new Error("never")), 30000); signal.addEventListener("abort", () => { clearTimeout(t); rej(new Error("cancelled")); }); }); return {}; });
await dispatchExecutions({ budgetMs: 20000 });
console.log("timeout row:", (await supabaseAdmin.from("executions").select("status,error,duration_ms").eq("id", slow.id).single()).data);

await supabaseAdmin.from("executions").delete().in("id", [ok.id, slow.id]);
