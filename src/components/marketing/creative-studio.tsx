import { useMemo, useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCreativeRequests, useMarketingMutations, useCampaigns } from "@/hooks/use-marketing";
import { useWorkers } from "@/hooks/use-workers";
import { useI18n } from "@/lib/i18n";
import {
  CREATIVE_KINDS,
  CREATIVE_KIND_MAP,
  CREATIVE_STATUS_LABELS,
  type CreativeKind,
} from "@/lib/marketing/catalog";

/**
 * Creative Studio — a single brief entry point for every asset type. The
 * marketing agent never generates anything itself: it routes the brief to the
 * specialised worker that owns that creative discipline.
 */
export function CreativeStudio({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: requests = [], isLoading } = useCreativeRequests(workspaceId);
  const { data: campaigns = [] } = useCampaigns(workspaceId);
  const { data: workers = [] } = useWorkers(workspaceId);
  const mutations = useMarketingMutations(workspaceId);

  const [kind, setKind] = useState<CreativeKind>("image");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [campaignId, setCampaignId] = useState("none");
  const [workerId, setWorkerId] = useState("none");
  const [variant, setVariant] = useState("");

  const definition = CREATIVE_KIND_MAP.get(kind);

  /** Workers whose declared purpose matches the creative discipline. */
  const suggested = useMemo(
    () => workers.filter((worker) => worker.purpose === definition?.executorPurpose),
    [workers, definition?.executorPurpose],
  );

  async function submit() {
    if (!workspaceId) return;
    if (!title.trim()) {
      toast.error(t("Give the creative task a title"));
      return;
    }
    try {
      await mutations.requestCreative.mutateAsync({
        kind,
        title: title.trim(),
        brief: brief.trim() || null,
        campaignId: campaignId === "none" ? null : campaignId,
        workerId: workerId === "none" ? null : workerId,
        variantLabel: variant.trim() || null,
      });
      setTitle("");
      setBrief("");
      setVariant("");
      toast.success(t("Creative task delegated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Something went wrong"));
    }
  }

  async function duplicateAsVariant(requestId: string) {
    const source = requests.find((row) => row.id === requestId);
    if (!source) return;
    const existing = requests.filter((row) => row.parent_request_id === source.id).length;
    await mutations.requestCreative.mutateAsync({
      kind: source.kind,
      title: source.title,
      brief: source.brief,
      campaignId: source.campaign_id,
      workerId: source.assigned_worker_id,
      variantLabel: `${t("Variant")} ${String.fromCharCode(66 + existing)}`,
      parentRequestId: source.id,
    });
    toast.success(t("A/B variant created"));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wand2 className="size-4" />
            {t("New creative brief")}
          </CardTitle>
          <CardDescription>
            {t("Choose what you need, and the command center assigns the right specialised worker.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {CREATIVE_KINDS.map((item) => {
              const Icon = item.icon;
              const active = item.value === kind;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setKind(item.value)}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-start transition ${
                    active ? "border-primary bg-primary/5" : "hover:bg-surface"
                  }`}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{t(item.label)}</span>
                    <span className="block text-xs text-muted-foreground">{t(item.description)}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Title")}</Label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Campaign")}</Label>
              <Select value={campaignId} onValueChange={setCampaignId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("No campaign")}</SelectItem>
                  {campaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Executing worker")}</Label>
              <Select value={workerId} onValueChange={setWorkerId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("Select a worker")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("Keep as draft")}</SelectItem>
                  {(suggested.length ? suggested : workers).map((worker) => (
                    <SelectItem key={worker.id} value={worker.id}>
                      {worker.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {suggested.length
                  ? t("Workers matching this discipline are listed first.")
                  : t("No specialised worker found for this discipline yet.")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Variant label (A/B)")}</Label>
              <Input
                value={variant}
                onChange={(event) => setVariant(event.target.value)}
                placeholder={t("Variant A")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("Brief")}</Label>
            <Textarea
              rows={3}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder={t("Audience, message, tone and any mandatory elements.")}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {t("Estimated cost")}: {definition?.unitCost ?? 0} {t("credits")}
            </p>
            <Button onClick={submit} disabled={!workspaceId || mutations.requestCreative.isPending}>
              <Sparkles className="size-4" />
              {t("Delegate task")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Creative pipeline")}</CardTitle>
          <CardDescription>{t("Every requested asset and the worker responsible for it.")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
          ) : requests.length === 0 ? (
            <EmptyState
              icon={Wand2}
              title="No creative work yet"
              description="Submit your first brief and it will be routed to a specialised worker."
              compact
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Asset")}</TableHead>
                    <TableHead>{t("Type")}</TableHead>
                    <TableHead>{t("Worker")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
                    <TableHead>{t("Cost")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium">
                        {request.title}
                        {request.variant_label && (
                          <Badge variant="outline" className="ms-2">
                            {request.variant_label}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t(CREATIVE_KIND_MAP.get(request.kind)?.label ?? request.kind)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {workers.find((worker) => worker.id === request.assigned_worker_id)?.name ??
                          t("Unassigned")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{t(CREATIVE_STATUS_LABELS[request.status])}</Badge>
                      </TableCell>
                      <TableCell>{Number(request.credit_cost)}</TableCell>
                      <TableCell className="text-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void duplicateAsVariant(request.id)}
                        >
                          {t("Create variant")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => mutations.deleteCreative.mutate(request)}
                        >
                          {t("Delete")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
