import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ActivityLog } from "@/components/execution/activity-log";
import { PageHeader } from "@/components/page-header";
import { WorkflowsTable } from "@/components/workflow/workflows-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useActivityLog } from "@/hooks/use-executions";
import { useWorkflowMutations, useWorkflows } from "@/hooks/use-workflows";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import type { WorkflowDefinition } from "@/services/workflow-service";

export const Route = createFileRoute("/_authenticated/workflow/")({
  head: () => ({
    meta: [
      { title: "Workflow Center — ZYRONEX" },
      {
        name: "description",
        content:
          "Design, version and publish multi-step AI workflows executed by the ZYRONEX execution engine.",
      },
      { property: "og:title", content: "Workflow Center — ZYRONEX" },
      {
        property: "og:description",
        content: "Design, version and publish multi-step AI workflows.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WorkflowRoute,
});

function WorkflowRoute() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const { data, isLoading } = useWorkflows(workspaceId);
  const { data: activity } = useActivityLog(workspaceId);
  const { createWorkflow, importWorkflow } = useWorkflowMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      const workflow = await createWorkflow.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
      });
      setOpen(false);
      setName("");
      setDescription("");
      navigate({ to: "/workflow/$workflowId", params: { workflowId: workflow.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  async function handleImport(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<WorkflowDefinition>;
      if (!parsed || typeof parsed.name !== "string" || !parsed.name.trim()) {
        throw new Error(t("The file does not contain a valid workflow definition."));
      }
      const workflow = await importWorkflow.mutateAsync({ ...parsed, name: parsed.name });
      toast.success(t("Workflow imported"));
      navigate({ to: "/workflow/$workflowId", params: { workflowId: workflow.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Import failed"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Workflow Center")}
        description={t(
          "Orchestrate multi-step, multi-agent processes with triggers, branching and retries.",
        )}
        actions={
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handleImport(file);
              }}
            />
            <Button variant="outline" className="gap-2" onClick={() => fileInput.current?.click()}>
              <Upload className="size-4" />
              {t("Import")}
            </Button>
            <Button className="gap-2" onClick={() => setOpen(true)} disabled={!workspaceId}>
              <Plus className="size-4" />
              {t("Create Workflow")}
            </Button>
          </div>
        }
      />

      <WorkflowsTable
        workflows={data ?? []}
        workspaceId={workspaceId}
        isLoading={isLoading}
        onCreate={() => setOpen(true)}
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("Recent engine activity")}</h2>
        <ActivityLog entries={activity ?? []} limit={8} />
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Create Workflow")}</DialogTitle>
            <DialogDescription>
              {t("Name your workflow, then design it on the canvas.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="workflow-name">{t("Name")}</Label>
              <Input
                id="workflow-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("Lead qualification")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workflow-description">{t("Description")}</Label>
              <Textarea
                id="workflow-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={() => void handleCreate()} disabled={!name.trim() || createWorkflow.isPending}>
              {t("Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
