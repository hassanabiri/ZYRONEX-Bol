import { useMemo, useState } from "react";
import {
  Archive,
  Hash,
  Link2,
  Link2Off,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { useVoiceMutations } from "@/hooks/use-voice";
import { useI18n } from "@/lib/i18n";
import {
  NUMBER_STATUS_LABELS,
  NUMBER_STATUS_TONE,
  NUMBER_TYPES,
  type VoiceNumberType,
} from "@/lib/voice/catalog";
import type { VoiceNumber, VoiceProvider } from "@/services/voice-service";

const emptyForm = {
  label: "",
  phone_number: "",
  number_type: "platform" as VoiceNumberType,
  country: "SA",
  provider_id: "none",
  tags: "",
};

/** Number registry: register, connect, verify, archive and delete numbers. */
export function VoiceNumbers({
  workspaceId,
  numbers,
  providers,
  loading,
  canManage,
}: {
  workspaceId: string | undefined;
  numbers: VoiceNumber[];
  providers: VoiceProvider[];
  loading?: boolean;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const mutations = useVoiceMutations(workspaceId);
  const [term, setTerm] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const rows = useMemo(() => {
    const query = term.trim().toLowerCase();
    return numbers.filter((item) => {
      if (type !== "all" && item.number_type !== type) return false;
      if (status !== "all" && item.status !== status) return false;
      if (!query) return true;
      return (
        item.label.toLowerCase().includes(query) ||
        item.phone_number.toLowerCase().includes(query) ||
        item.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [numbers, term, type, status]);

  async function run(label: string, action: Promise<unknown>) {
    try {
      await action;
      toast.success(t(label));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  async function register() {
    if (!form.label.trim() || !form.phone_number.trim()) {
      toast.error(t("Label and number are required"));
      return;
    }
    await run(
      "Number registered",
      mutations.registerNumber.mutateAsync({
        label: form.label.trim(),
        phone_number: form.phone_number.trim(),
        number_type: form.number_type,
        country: form.country.trim().toUpperCase() || "SA",
        provider_id: form.provider_id === "none" ? null : form.provider_id,
        tags: form.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    );
    setForm(emptyForm);
    setOpen(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row">
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t("Search numbers, labels or tags")}
            className="sm:max-w-xs"
          />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All types")}</SelectItem>
              {NUMBER_TYPES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {t(item.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All statuses")}</SelectItem>
              {Object.entries(NUMBER_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {t(label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            {t("Register number")}
          </Button>
        )}
      </div>

      {!loading && numbers.length === 0 ? (
        <EmptyState
          icon={Hash}
          title="No numbers registered"
          description="Register a platform number or bring your own carrier number to start routing calls."
          action={canManage ? <Button onClick={() => setOpen(true)}>{t("Register number")}</Button> : undefined}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Number")}</TableHead>
                    <TableHead>{t("Type")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Tags")}</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((number) => (
                    <TableRow key={number.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{number.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {number.phone_number} · {number.country}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t(
                          NUMBER_TYPES.find((item) => item.value === number.number_type)?.label ??
                            number.number_type,
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={NUMBER_STATUS_TONE[number.status]}>
                          {t(NUMBER_STATUS_LABELS[number.status])}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {number.tags.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            number.tags.map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-[10px]">
                                {tag}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={t("Actions")}>
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() =>
                                  run(
                                    "Number connected",
                                    mutations.transitionNumber.mutateAsync({ number, action: "connect" }),
                                  )
                                }
                              >
                                <Link2 className="size-4" />
                                {t("Connect")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  run(
                                    "Number disconnected",
                                    mutations.transitionNumber.mutateAsync({
                                      number,
                                      action: "disconnect",
                                    }),
                                  )
                                }
                              >
                                <Link2Off className="size-4" />
                                {t("Disconnect")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  run(
                                    "Verification started",
                                    mutations.transitionNumber.mutateAsync({ number, action: "verify" }),
                                  )
                                }
                              >
                                <ShieldCheck className="size-4" />
                                {t("Verify")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  run(
                                    "Number archived",
                                    mutations.transitionNumber.mutateAsync({ number, action: "archive" }),
                                  )
                                }
                              >
                                <Archive className="size-4" />
                                {t("Archive")}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() =>
                                  run("Number deleted", mutations.removeNumber.mutateAsync(number))
                                }
                              >
                                <Trash2 className="size-4" />
                                {t("Delete")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Register number")}</DialogTitle>
            <DialogDescription>
              {t("Platform numbers and customer-owned numbers (BYON) are both supported.")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="number-label">{t("Label")}</Label>
              <Input
                id="number-label"
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
                placeholder={t("Support line")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="number-value">{t("Phone number")}</Label>
              <Input
                id="number-value"
                value={form.phone_number}
                onChange={(event) => setForm({ ...form, phone_number: event.target.value })}
                placeholder="+9665xxxxxxx"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="number-country">{t("Country")}</Label>
              <Input
                id="number-country"
                value={form.country}
                onChange={(event) => setForm({ ...form, country: event.target.value })}
                maxLength={2}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("Type")}</Label>
              <Select
                value={form.number_type}
                onValueChange={(value) => setForm({ ...form, number_type: value as VoiceNumberType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NUMBER_TYPES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {t(item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("Provider")}</Label>
              <Select
                value={form.provider_id}
                onValueChange={(value) => setForm({ ...form, provider_id: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("Unassigned")}</SelectItem>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="number-tags">{t("Tags")}</Label>
              <Input
                id="number-tags"
                value={form.tags}
                onChange={(event) => setForm({ ...form, tags: event.target.value })}
                placeholder={t("comma,separated")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={register} disabled={mutations.registerNumber.isPending}>
              {t("Register")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
