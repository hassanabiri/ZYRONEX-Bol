import { createFileRoute } from "@tanstack/react-router";
import { Plus, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { DocumentManager } from "@/components/knowledge/document-manager";
import { KnowledgeAssignment } from "@/components/knowledge/knowledge-assignment";
import { KnowledgeBaseList } from "@/components/knowledge/knowledge-base-list";
import { KnowledgeSearch } from "@/components/knowledge/knowledge-search";
import { PageHeader } from "@/components/page-header";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  useKnowledgeBases,
  useKnowledgeMutations,
  useWorkspaceDocuments,
} from "@/hooks/use-knowledge";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { KNOWLEDGE_CATEGORIES, type KnowledgeBaseDefinition } from "@/services/knowledge-service";

export const Route = createFileRoute("/_authenticated/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge Center — ZYRONEX" },
      {
        name: "description",
        content:
          "Build knowledge bases, ingest documents through the indexing pipeline and ground every AI worker.",
      },
      { property: "og:title", content: "Knowledge Center — ZYRONEX" },
      {
        property: "og:description",
        content: "Knowledge bases, ingestion pipeline, retrieval and worker grounding.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: KnowledgeRoute,
});

function KnowledgeRoute() {
  const { t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const { data: bases, isLoading } = useKnowledgeBases(workspaceId);
  const { data: documents } = useWorkspaceDocuments(workspaceId);
  const { createBase, importBase } = useKnowledgeMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [activeId, setActiveId] = useState<string | undefined>();
  const fileInput = useRef<HTMLInputElement>(null);

  const activeBase = useMemo(
    () => (bases ?? []).find((base) => base.id === activeId) ?? bases?.[0],
    [bases, activeId],
  );

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      const base = await createBase.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        category,
      });
      setOpen(false);
      setName("");
      setDescription("");
      setActiveId(base.id);
      toast.success(t("Knowledge base created"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  async function handleImport(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<KnowledgeBaseDefinition>;
      if (!parsed || typeof parsed.name !== "string" || !parsed.name.trim()) {
        throw new Error(t("The file does not contain a valid knowledge base."));
      }
      await importBase.mutateAsync({ ...parsed, name: parsed.name });
      toast.success(t("Knowledge base imported"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Import failed"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Knowledge Center")}
        description={t(
          "Ingest, index and govern the knowledge your agents are allowed to reason over.",
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
              {t("Create Knowledge Base")}
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="bases" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="bases">{t("Knowledge bases")}</TabsTrigger>
          <TabsTrigger value="documents">{t("Documents")}</TabsTrigger>
          <TabsTrigger value="search">{t("Retrieval")}</TabsTrigger>
          <TabsTrigger value="assignment">{t("Worker assignment")}</TabsTrigger>
        </TabsList>

        <TabsContent value="bases">
          <KnowledgeBaseList
            bases={bases ?? []}
            documents={documents ?? []}
            workspaceId={workspaceId}
            isLoading={isLoading}
            activeId={activeBase?.id}
            onSelect={(base) => setActiveId(base.id)}
            onCreate={() => setOpen(true)}
          />
        </TabsContent>

        <TabsContent value="documents">
          {activeBase ? (
            <DocumentManager base={activeBase} workspaceId={workspaceId} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("Create a knowledge base first, then add documents to it.")}
            </p>
          )}
        </TabsContent>

        <TabsContent value="search">
          <KnowledgeSearch workspaceId={workspaceId} bases={bases ?? []} />
        </TabsContent>

        <TabsContent value="assignment">
          <KnowledgeAssignment workspaceId={workspaceId} bases={bases ?? []} />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Create Knowledge Base")}</DialogTitle>
            <DialogDescription>
              {t("Group related documents so workers can be grounded on them.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="kb-name">{t("Name")}</Label>
              <Input id="kb-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("Category")}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWLEDGE_CATEGORIES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="kb-description">{t("Description")}</Label>
              <Textarea
                id="kb-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={() => void handleCreate()} disabled={!name.trim()}>
              {t("Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
