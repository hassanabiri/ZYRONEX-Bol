import { useState } from "react";
import { ScrollText, ShieldCheck } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useApprovals, useMarketingAudit, useMarketingMutations } from "@/hooks/use-marketing";
import { useI18n } from "@/lib/i18n";
import { APPROVAL_SUBJECTS, APPROVAL_SUBJECT_MAP } from "@/lib/marketing/catalog";

/** Governance: multi-level approvals plus the append-only marketing audit trail. */
export function GovernancePanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const { data: approvals = [] } = useApprovals(workspaceId);
  const { data: audit = [] } = useMarketingAudit(workspaceId);
  const mutations = useMarketingMutations(workspaceId);

  const [subject, setSubject] = useState(APPROVAL_SUBJECTS[0]!.value);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [details, setDetails] = useState("");

  async function submit() {
    if (!title.trim()) {
      toast.error(t("Give the request a title"));
      return;
    }
    await mutations.requestApproval.mutateAsync({
      subject_type: subject,
      title: title.trim(),
      details: details.trim() || null,
      amount: amount ? Number(amount) : null,
      levels_required: APPROVAL_SUBJECT_MAP.get(subject)?.levels ?? 1,
    });
    setTitle("");
    setAmount("");
    setDetails("");
    toast.success(t("Approval requested"));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" />
            {t("Approvals")}
          </CardTitle>
          <CardDescription>
            {t("Spend, transfers and publishing can require one or two levels of sign-off.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Type")}</Label>
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPROVAL_SUBJECTS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {t(item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Amount")}</Label>
              <Input value={amount} onChange={(event) => setAmount(event.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("Title")}</Label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("Details")}</Label>
              <Textarea rows={2} value={details} onChange={(event) => setDetails(event.target.value)} />
            </div>
          </div>
          <Button onClick={submit} disabled={mutations.requestApproval.isPending}>
            {t("Request approval")}
          </Button>

          {approvals.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No approval requests"
              description="Sensitive marketing actions will queue here for sign-off."
              compact
            />
          ) : (
            <div className="space-y-2">
              {approvals.map((approval) => (
                <div key={approval.id} className="space-y-1 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {t(APPROVAL_SUBJECT_MAP.get(approval.subject_type)?.label ?? approval.subject_type)}
                      </Badge>
                      <p className="text-sm font-medium">{approval.title}</p>
                      <Badge
                        variant={
                          approval.status === "approved"
                            ? "default"
                            : approval.status === "rejected"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {t(approval.status)}
                      </Badge>
                    </div>
                    {approval.status === "pending" && canManage && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            mutations.decideApproval.mutate({ approval, decision: "approve", note: null })
                          }
                        >
                          {t("Approve")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            mutations.decideApproval.mutate({ approval, decision: "reject", note: null })
                          }
                        >
                          {t("Reject")}
                        </Button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("Level")} {approval.levels_approved}/{approval.levels_required}
                    {approval.amount ? ` · $${Number(approval.amount).toLocaleString()}` : ""}
                  </p>
                  {approval.details && <p className="text-xs">{approval.details}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="size-4" />
            {t("Audit log")}
          </CardTitle>
          <CardDescription>{t("Every marketing action, who took it and why.")}</CardDescription>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="Nothing recorded yet"
              description="Actions taken in the command center are written here automatically."
              compact
            />
          ) : (
            <ul className="space-y-2">
              {audit.slice(0, 40).map((entry) => (
                <li key={entry.id} className="rounded-lg border p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{entry.action}</span>
                    <span className="text-muted-foreground">
                      {new Date(entry.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    {entry.entity_type}
                    {entry.reason ? ` · ${entry.reason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
