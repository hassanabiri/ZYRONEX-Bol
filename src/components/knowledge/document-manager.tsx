import {
  ChevronRight,
  FileText,
  FolderPlus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useKnowledgeDocuments, useKnowledgeFolders, useKnowledgeMutations } from "@/hooks/use-knowledge";
import { useI18n } from "@/lib/i18n";
import { humanize } from "@/lib/worker-options";
import {
  KNOWLEDGE_SOURCES,
  PIPELINE_STAGES,
  type KnowledgeBase,
  type KnowledgeDocument,
  type KnowledgeSource,
} from "@/services/knowledge-service";

function stageProgress(document: KnowledgeDocument) {
  if (document.status === "failed") return 100;
  const index = PIPELINE_STAGES.indexOf(document.status);
  if (index < 0) return 5;
  return Math.round(((index + 1) / PIPELINE_STAGES.length) * 100);
}

export function DocumentManager({
  base,
  workspaceId,
}: {
  base: KnowledgeBase;
  workspaceId: string | undefined;
}) {
  const { t } = useI18n();
  const { data: documents, isLoading } = useKnowledgeDocuments(base.id);
  const { data: folders } = useKnowledgeFolders(base.id);
  const {
    createDocument,
    advanceDocument,
    reindexDocument,
    deleteDocument,
    updateDocument,
    snapshotDocument,
    createFolder,
  } = useKnowledgeMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState<KnowledgeSource>("manual");
  const [sourceUrl, setSourceUrl] = useState("");
  const [content, setContent] = useState("");
  const [folderId, setFolderId] = useState<string>("root");
  const [filter, setFilter] = useState("all");
  const fileInput = useRef<HTMLInputElement>(null);

  const rows = useMemo(
    () =>
      (documents ?? []).filter((doc) =>
        filter === "all"
          ? !doc.archived
          : filter === "archived"
            ? doc.archived
            : doc.status === filter && !doc.archived,
      ),
    [documents, filter],
  );

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      await createDocument.mutateAsync({
        knowledge_base_id: base.id,
        folder_id: folderId === "root" ? null : folderId,
        name: name.trim(),
        source,
        source_url: sourceUrl.trim() || null,
        content: content.trim() || null,
        size_bytes: content.length,
      });
      setOpen(false);
      setName("");
      setContent("");
      setSourceUrl("");
      toast.success(t("Document added"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  async function handleUpload(file: File) {
    const isText = /^text\/|json|markdown|csv/.test(file.type) || /\.(txt|md|csv|json)$/i.test(file.name);
    try {
      await createDocument.mutateAsync({
        knowledge_base_id: base.id,
        name: file.name,
        source: file.name.toLowerCase().endsWith(".csv")
          ? "csv"
          : file.name.toLowerCase().endsWith(".md")
            ? "markdown"
            : isText
              ? "txt"
              : "pdf",
        mime_type: file.type || null,
        size_bytes: file.size,
        content: isText ? await file.text() : null,
        status: isText ? "extracting" : "uploaded",
      });
      toast.success(t("Document added"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Upload failed"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">{t("Documents")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("Upload, organise and index the material behind this knowledge base.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All documents")}</SelectItem>
              {PIPELINE_STAGES.map((stage) => (
                <SelectItem key={stage} value={stage}>
                  {humanize(stage)}
                </SelectItem>
              ))}
              <SelectItem value="archived">{t("archived")}</SelectItem>
            </SelectContent>
          </Select>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleUpload(file);
            }}
          />
          <Button variant="outline" className="gap-2" onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" />
            {t("Upload")}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              const folderName = window.prompt(t("Folder name"));
              if (folderName?.trim()) {
                createFolder.mutate({ base, name: folderName.trim() });
              }
            }}
          >
            <FolderPlus className="size-4" />
            {t("Folder")}
          </Button>
          <Button className="gap-2" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            {t("Add source")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
      ) : !rows.length ? (
        <EmptyState
          icon={FileText}
          title="No documents yet"
          description="Add a file, a website, an FAQ or raw text and run it through the ingestion pipeline."
          action={<Button onClick={() => setOpen(true)}>{t("Add source")}</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((doc) => (
            <li key={doc.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{doc.name}</p>
                    <Badge variant="outline">{humanize(doc.source)}</Badge>
                    <Badge variant={doc.status === "failed" ? "destructive" : "secondary"}>
                      {humanize(doc.status)}
                    </Badge>
                    {doc.archived && <Badge variant="outline">{t("archived")}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {doc.chunk_count} {t("chunks")} · {doc.token_estimate} {t("tokens")} · v
                    {doc.version}
                    {folders?.find((folder) => folder.id === doc.folder_id)
                      ? ` · ${folders.find((folder) => folder.id === doc.folder_id)?.name}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={doc.status === "available"}
                    onClick={() => advanceDocument.mutate(doc)}
                  >
                    <ChevronRight className="size-4" />
                    {t("Advance")}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t("Actions")}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => reindexDocument.mutate(doc)}>
                        <RefreshCw className="size-4" />
                        {t("Re-index")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => snapshotDocument.mutate(doc)}>
                        <FileText className="size-4" />
                        {t("Snapshot version")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          updateDocument.mutate({
                            documentId: doc.id,
                            patch: { archived: !doc.archived },
                          })
                        }
                      >
                        {doc.archived ? t("Restore") : t("Archive")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => deleteDocument.mutate(doc)}
                      >
                        <Trash2 className="size-4" />
                        {t("Delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <Progress value={stageProgress(doc)} className="mt-3 h-1.5" />
              {doc.error && <p className="mt-2 text-xs text-destructive">{doc.error}</p>}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Add source")}</DialogTitle>
            <DialogDescription>
              {t("Register a document, website, FAQ or manual text in this knowledge base.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="doc-name">{t("Name")}</Label>
              <Input id="doc-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("Source type")}</Label>
                <Select value={source} onValueChange={(value) => setSource(value as KnowledgeSource)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KNOWLEDGE_SOURCES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {humanize(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("Folder")}</Label>
                <Select value={folderId} onValueChange={setFolderId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="root">{t("Root")}</SelectItem>
                    {(folders ?? []).map((folder) => (
                      <SelectItem key={folder.id} value={folder.id}>
                        {folder.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-url">{t("Source URL")}</Label>
              <Input
                id="doc-url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-content">{t("Content")}</Label>
              <Textarea
                id="doc-content"
                rows={6}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={() => void handleCreate()} disabled={!name.trim()}>
              {t("Add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
