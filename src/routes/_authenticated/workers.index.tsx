import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { CreateWorkerWizard } from "@/components/workers/create-worker-wizard";
import { WorkerStats } from "@/components/workers/worker-stats";
import { WorkersTable } from "@/components/workers/workers-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkerMutations, useWorkers } from "@/hooks/use-workers";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import type { WorkerDefinition } from "@/services/worker-service";

export const Route = createFileRoute("/_authenticated/workers/")({
  head: () => ({
    meta: [
      { title: "AI Workers — ZYRONEX" },
      {
        name: "description",
        content:
          "Create, organize and govern the AI workers of your workspace: identity, purpose, provider and lifecycle.",
      },
      { property: "og:title", content: "AI Workers — ZYRONEX" },
      {
        property: "og:description",
        content: "Build and manage the AI worker estate of your workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WorkersRoute,
});

function WorkersRoute() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const { data, isLoading } = useWorkers(workspaceId);
  const { importWorker } = useWorkerMutations(workspaceId);
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const workers = data ?? [];

  async function handleImport(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<WorkerDefinition>;
      if (!parsed || typeof parsed.name !== "string" || !parsed.name.trim()) {
        throw new Error(t("The file does not contain a valid worker definition."));
      }
      const worker = await importWorker.mutateAsync({ ...parsed, name: parsed.name });
      toast.success(t("Worker imported"));
      navigate({ to: "/workers/$workerId", params: { workerId: worker.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Import failed"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("AI Workers")}
        description={t(
          "Design, organize and govern every AI worker in this workspace. Configuration only — no AI execution.",
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
              {t("Create Worker")}
            </Button>
          </div>
        }
      />

      <WorkerStats workers={workers} />

      <WorkersTable
        workers={workers}
        workspaceId={workspaceId}
        isLoading={isLoading}
        onCreate={() => setOpen(true)}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Create AI Worker")}</DialogTitle>
            <DialogDescription>
              {t("Five short steps to define a new worker for this workspace.")}
            </DialogDescription>
          </DialogHeader>
          <CreateWorkerWizard
            workspaceId={workspaceId}
            onCancel={() => setOpen(false)}
            onCreated={(workerId) => {
              setOpen(false);
              navigate({ to: "/workers/$workerId", params: { workerId } });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
