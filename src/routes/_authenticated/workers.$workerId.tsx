import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  Archive,
  ArrowLeft,
  BookOpen,
  Brain,
  Copy,
  Download,
  GitBranch,
  Layers,
  Pause,
  Play,
  Plug,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Wrench,
  X,
  AudioLines,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { WorkerAvatar } from "@/components/workers/worker-avatar";
import { downloadWorker } from "@/components/workers/workers-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  useWorker,
  useWorkerActivity,
  useWorkerMutations,
  useWorkerNotes,
  useWorkerVersions,
} from "@/hooks/use-workers";
import { useI18n } from "@/lib/i18n";
import {
  humanize,
  statusVariant,
  WORKER_PROVIDER_SUGGESTIONS,
  WORKER_STATUSES,
} from "@/lib/worker-options";
import { useWorkspace } from "@/lib/workspace";
import {
  WORKSPACE_LANGUAGES,
  WORKSPACE_REGIONS,
  WORKSPACE_TIMEZONES,
} from "@/lib/workspace-options";
import type { Worker } from "@/services/worker-service";

export const Route = createFileRoute("/_authenticated/workers/$workerId")({
  head: () => ({
    meta: [
      { title: "Worker Details — ZYRONEX" },
      {
        name: "description",
        content: "Configuration, knowledge, memory, tools, permissions, activity and versions of an AI worker.",
      },
      { property: "og:title", content: "Worker Details — ZYRONEX" },
      { property: "og:description", content: "Full lifecycle view of a single AI worker." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WorkerDetailRoute,
});

const PLACEHOLDER_TABS = [
  {

    value: "tools",
    label: "Tools",
    icon: Wrench,
    title: "No tools enabled",
    description: "Grant this worker access to the tools it may call during a run.",
  },
  {
    value: "integrations",
    label: "Integrations",
    icon: Plug,
    title: "No integrations connected",
    description: "Connect workspace integrations so this worker can operate inside your stack.",
  },
  {
    value: "voice",
    label: "Voice",
    icon: AudioLines,
    title: "No voice profile",
    description: "Assign a voice profile once the Voice Center is configured for this workspace.",
  },
  {
    value: "permissions",
    label: "Permissions",
    icon: ShieldCheck,
    title: "Inheriting workspace permissions",
    description: "Per-worker permission overrides will be managed here alongside workspace roles.",
  },
] as const;

function WorkerDetailRoute() {
  const { workerId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspace();
  const { data: worker, isLoading } = useWorker(workerId);
  const { updateWorker, deleteWorker, duplicateWorker } = useWorkerMutations(activeWorkspace?.id);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("Loading worker…")}</p>;
  }

  if (!worker) {
    return (
      <EmptyState
        icon={Layers}
        title="Worker not found"
        description="This worker may have been deleted or belongs to another workspace."
        action={
          <Button asChild>
            <Link to="/workers">{t("Back to AI Workers")}</Link>
          </Button>
        }
      />
    );
  }

  const setStatus = (status: Worker["status"]) =>
    updateWorker
      .mutateAsync({ workerId: worker.id, patch: { status } })
      .then(() => toast.success(t("Worker updated")))
      .catch(() => toast.error(t("Action failed")));

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="gap-2 ps-0">
        <Link to="/workers">
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t("Back to AI Workers")}
        </Link>
      </Button>

      <div className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:p-5">
        <WorkerAvatar
          icon={worker.icon}
          color={worker.color}
          avatarUrl={worker.avatar_url}
          className="size-14 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold sm:text-2xl">{worker.name}</h1>
            <Badge variant={statusVariant(worker.status)}>{t(humanize(worker.status))}</Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {worker.description || t("No description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {worker.status !== "active" ? (
            <Button size="sm" className="gap-2" onClick={() => setStatus("active")}>
              <Play className="size-4" /> {t("Activate")}
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="gap-2" onClick={() => setStatus("paused")}>
              <Pause className="size-4" /> {t("Pause")}
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setStatus("archived")}>
            <Archive className="size-4" /> {t("Archive")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() =>
              duplicateWorker
                .mutateAsync(worker)
                .then(() => toast.success(t("Worker duplicated")))
                .catch(() => toast.error(t("Action failed")))
            }
          >
            <Copy className="size-4" /> {t("Duplicate")}
          </Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => downloadWorker(worker)}>
            <Download className="size-4" /> {t("Export")}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="gap-2"
            onClick={() =>
              deleteWorker
                .mutateAsync(worker.id)
                .then(() => {
                  toast.success(t("Worker deleted"));
                  navigate({ to: "/workers" });
                })
                .catch(() => toast.error(t("Action failed")))
            }
          >
            <Trash2 className="size-4" /> {t("Delete")}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">{t("Overview")}</TabsTrigger>
          <TabsTrigger value="configuration">{t("Configuration")}</TabsTrigger>
          {PLACEHOLDER_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {t(tab.label)}
            </TabsTrigger>
          ))}
          <TabsTrigger value="activity">{t("Activity")}</TabsTrigger>
          <TabsTrigger value="versions">{t("Versions")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab worker={worker} />
        </TabsContent>

        <TabsContent value="configuration">
          <ConfigurationTab worker={worker} />
        </TabsContent>

        {PLACEHOLDER_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <EmptyState icon={tab.icon} title={tab.title} description={tab.description} />
          </TabsContent>
        ))}

        <TabsContent value="activity">
          <ActivityTab worker={worker} />
        </TabsContent>

        <TabsContent value="versions">
          <VersionsTab worker={worker} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({ worker }: { worker: Worker }) {
  const { t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const { updateWorker, addNote, deleteNote } = useWorkerMutations(activeWorkspace?.id);
  const { data: notes } = useWorkerNotes(worker.id);
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");

  const tags = worker.tags ?? [];

  const saveTags = (next: string[]) =>
    updateWorker
      .mutateAsync({ workerId: worker.id, patch: { tags: next } })
      .catch(() => toast.error(t("Action failed")));

  const facts: [string, string][] = [
    ["Type", humanize(worker.type)],
    ["Purpose", humanize(worker.purpose)],
    ["AI Provider", humanize(worker.provider)],
    ["Model", worker.model || "—"],
    ["Language", worker.language ?? "—"],
    ["Timezone", worker.timezone ?? "—"],
    ["Region", humanize(worker.region)],
    ["Created", new Date(worker.created_at).toLocaleString()],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="panel-shadow">
        <CardHeader>
          <CardTitle className="text-base">{t("Summary")}</CardTitle>
          <CardDescription>{t("Core definition of this worker.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 sm:grid-cols-2">
            {facts.map(([label, value]) => (
              <div key={label} className="rounded-lg border px-3 py-2">
                <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {t(label)}
                </dt>
                <dd className="truncate text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card className="panel-shadow">
        <CardHeader>
          <CardTitle className="text-base">{t("Tags")}</CardTitle>
          <CardDescription>{t("Organize workers across teams and use cases.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {tags.length === 0 && <p className="text-sm text-muted-foreground">{t("No tags yet")}</p>}
            {tags.map((value) => (
              <Badge key={value} variant="secondary" className="gap-1">
                {value}
                <button
                  type="button"
                  aria-label={t("Remove tag")}
                  onClick={() => saveTags(tags.filter((item) => item !== value))}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = tag.trim();
              if (!value || tags.includes(value)) return;
              saveTags([...tags, value]);
              setTag("");
            }}
          >
            <Input value={tag} onChange={(event) => setTag(event.target.value)} placeholder={t("Add a tag")} />
            <Button type="submit" variant="outline" size="icon" aria-label={t("Add a tag")}>
              <Plus className="size-4" />
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="panel-shadow lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">{t("Internal Notes")}</CardTitle>
          <CardDescription>{t("Context for your team. Never sent to any model.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              const body = note.trim();
              if (!body) return;
              addNote
                .mutateAsync({ worker, body })
                .then(() => setNote(""))
                .catch(() => toast.error(t("Action failed")));
            }}
          >
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("Write a note for your team…")}
              rows={3}
            />
            <Button type="submit" size="sm" disabled={addNote.isPending}>
              {t("Add Note")}
            </Button>
          </form>

          {(notes ?? []).length === 0 ? (
            <EmptyState
              compact
              icon={Layers}
              title="No notes yet"
              description="Document decisions, prompts to revisit and open questions about this worker."
            />
          ) : (
            <ul className="space-y-2">
              {(notes ?? []).map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 rounded-lg border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm">{entry.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(entry.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("Delete")}
                    onClick={() => deleteNote.mutate({ workerId: worker.id, noteId: entry.id })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ConfigurationTab({ worker }: { worker: Worker }) {
  const { t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const { updateWorker } = useWorkerMutations(activeWorkspace?.id);

  const [form, setForm] = useState({
    name: worker.name,
    description: worker.description ?? "",
    status: worker.status as Worker["status"],
    provider: worker.provider ?? "openai",
    model: worker.model ?? "",
    language: worker.language ?? "en",
    timezone: worker.timezone ?? "UTC",
    region: worker.region ?? "us-east",
  });

  useEffect(() => {
    setForm({
      name: worker.name,
      description: worker.description ?? "",
      status: worker.status,
      provider: worker.provider ?? "openai",
      model: worker.model ?? "",
      language: worker.language ?? "en",
      timezone: worker.timezone ?? "UTC",
      region: worker.region ?? "us-east",
    });
  }, [worker]);

  return (
    <Card className="panel-shadow">
      <CardHeader>
        <CardTitle className="text-base">{t("Configuration")}</CardTitle>
        <CardDescription>
          {t("Providers are recorded as configuration only. No credentials are stored and no requests are sent.")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            updateWorker
              .mutateAsync({
                workerId: worker.id,
                patch: { ...form, description: form.description.trim() || null, model: form.model.trim() || null },
              })
              .then(() => toast.success(t("Worker updated")))
              .catch(() => toast.error(t("Action failed")));
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="cfg-name">{t("Worker Name")}</Label>
            <Input
              id="cfg-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("Status")}</Label>
            <Select
              value={form.status}
              onValueChange={(value) => setForm({ ...form, status: value as Worker["status"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKER_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(humanize(value))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="cfg-description">{t("Description")}</Label>
            <Textarea
              id="cfg-description"
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("AI Provider")}</Label>
            <Select value={form.provider} onValueChange={(value) => setForm({ ...form, provider: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(new Set([...WORKER_PROVIDER_SUGGESTIONS, form.provider])).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(humanize(value))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cfg-model">{t("Model (optional)")}</Label>
            <Input
              id="cfg-model"
              value={form.model}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("Language")}</Label>
            <Select value={form.language} onValueChange={(value) => setForm({ ...form, language: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKSPACE_LANGUAGES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("Timezone")}</Label>
            <Select value={form.timezone} onValueChange={(value) => setForm({ ...form, timezone: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKSPACE_TIMEZONES.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("Region")}</Label>
            <Select value={form.region} onValueChange={(value) => setForm({ ...form, region: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKSPACE_REGIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" className="gap-2" disabled={updateWorker.isPending}>
              <SlidersHorizontal className="size-4" />
              {t("Save Changes")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ActivityTab({ worker }: { worker: Worker }) {
  const { t } = useI18n();
  const { data } = useWorkerActivity(worker.id);
  const entries = data ?? [];

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity recorded"
        description="Every change to this worker is captured here as an auditable timeline."
      />
    );
  }

  return (
    <Card className="panel-shadow">
      <CardContent className="p-5">
        <ol className="relative space-y-5 ps-5">
          <span className="absolute inset-y-1 start-1.5 w-px bg-border" aria-hidden />
          {entries.map((entry) => (
            <li key={entry.id} className="relative">
              <span className="absolute -start-[13px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
              <p className="text-sm font-medium">{t(humanize(entry.action))}</p>
              {entry.detail && <p className="text-xs text-muted-foreground">{entry.detail}</p>}
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {new Date(entry.created_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function VersionsTab({ worker }: { worker: Worker }) {
  const { t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const { data } = useWorkerVersions(worker.id);
  const { createVersion } = useWorkerMutations(activeWorkspace?.id);
  const versions = data ?? [];

  return (
    <div className="space-y-4">
      <Button
        size="sm"
        className="gap-2"
        disabled={createVersion.isPending}
        onClick={() =>
          createVersion
            .mutateAsync({ worker })
            .then(() => toast.success(t("Version saved")))
            .catch(() => toast.error(t("Action failed")))
        }
      >
        <GitBranch className="size-4" />
        {t("Save Version")}
      </Button>

      {versions.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="No versions saved"
          description="Snapshot the current configuration so you can compare and restore it later."
        />
      ) : (
        <ul className="space-y-2">
          {versions.map((version) => (
            <li key={version.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
              <Badge variant="outline">v{version.version}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{version.label ?? `Version ${version.version}`}</p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(version.created_at).toLocaleString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
