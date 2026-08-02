import { useState } from "react";
import { AudioLines, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { useVoiceMutations } from "@/hooks/use-voice";
import { useWorkers } from "@/hooks/use-workers";
import { useI18n } from "@/lib/i18n";
import {
  RECORDING_POLICIES,
  VOICE_ACCENTS,
  VOICE_LANGUAGES,
  VOICE_OPTIONS,
} from "@/lib/voice/catalog";
import type { VoiceNumber, VoiceProfile } from "@/services/voice-service";

const emptyForm = {
  name: "",
  worker_id: "none",
  number_id: "none",
  voice: "neutral",
  language: "en",
  accent: "standard",
  greeting: "",
  silence_timeout_seconds: 8,
  max_call_duration_seconds: 900,
  recording_policy: "disabled",
  transfer_rules: "",
};

/** Voice workers: assign a voice profile and call behaviour to an AI Worker. */
export function VoiceProfiles({
  workspaceId,
  profiles,
  numbers,
  canManage,
}: {
  workspaceId: string | undefined;
  profiles: VoiceProfile[];
  numbers: VoiceNumber[];
  canManage: boolean;
}) {
  const { t } = useI18n();
  const mutations = useVoiceMutations(workspaceId);
  const { data: workers = [] } = useWorkers(workspaceId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VoiceProfile | null>(null);
  const [form, setForm] = useState(emptyForm);

  function startCreate() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function startEdit(profile: VoiceProfile) {
    setEditing(profile);
    setForm({
      name: profile.name,
      worker_id: profile.worker_id ?? "none",
      number_id: profile.number_id ?? "none",
      voice: profile.voice,
      language: profile.language,
      accent: profile.accent,
      greeting: profile.greeting ?? "",
      silence_timeout_seconds: profile.silence_timeout_seconds,
      max_call_duration_seconds: profile.max_call_duration_seconds,
      recording_policy: profile.recording_policy,
      transfer_rules: Array.isArray(profile.transfer_rules)
        ? (profile.transfer_rules as string[]).join(", ")
        : "",
    });
    setOpen(true);
  }

  async function submit() {
    if (!form.name.trim()) {
      toast.error(t("Profile name is required"));
      return;
    }
    const payload = {
      name: form.name.trim(),
      worker_id: form.worker_id === "none" ? null : form.worker_id,
      number_id: form.number_id === "none" ? null : form.number_id,
      voice: form.voice,
      language: form.language,
      accent: form.accent,
      greeting: form.greeting.trim() || null,
      silence_timeout_seconds: Number(form.silence_timeout_seconds) || 8,
      max_call_duration_seconds: Number(form.max_call_duration_seconds) || 900,
      recording_policy: form.recording_policy,
      transfer_rules: form.transfer_rules
        .split(",")
        .map((rule) => rule.trim())
        .filter(Boolean),
    };
    try {
      if (editing) await mutations.updateProfile.mutateAsync({ profile: editing, patch: payload });
      else await mutations.createProfile.mutateAsync(payload);
      toast.success(t(editing ? "Voice profile updated" : "Voice profile created"));
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        {canManage && (
          <Button onClick={startCreate}>
            <Plus className="size-4" />
            {t("New voice profile")}
          </Button>
        )}
      </div>

      {profiles.length === 0 ? (
        <EmptyState
          icon={AudioLines}
          title="No voice workers yet"
          description="Create a voice profile to give an AI Worker a voice, language and call policy."
          action={canManage ? <Button onClick={startCreate}>{t("New voice profile")}</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map((profile) => {
            const worker = workers.find((item) => item.id === profile.worker_id);
            return (
              <Card key={profile.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-sm">{profile.name}</CardTitle>
                      <CardDescription className="truncate text-xs">
                        {worker?.name ?? t("Unassigned worker")}
                      </CardDescription>
                    </div>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("Delete profile")}
                        onClick={() => mutations.removeProfile.mutate(profile)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary" className="text-[10px]">
                      {profile.voice}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {profile.language}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {profile.accent}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {profile.recording_policy}
                    </Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <dt>{t("Silence timeout")}</dt>
                      <dd className="font-medium text-foreground">
                        {profile.silence_timeout_seconds}s
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Max duration")}</dt>
                      <dd className="font-medium text-foreground">
                        {Math.round(profile.max_call_duration_seconds / 60)}m
                      </dd>
                    </div>
                  </dl>
                  {canManage && (
                    <Button variant="outline" size="sm" className="w-full" onClick={() => startEdit(profile)}>
                      {t("Configure")}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t(editing ? "Configure voice profile" : "New voice profile")}</DialogTitle>
            <DialogDescription>
              {t("Voice, language, call limits and recording policy for one AI Worker.")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="profile-name">{t("Name")}</Label>
              <Input
                id="profile-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("Worker")}</Label>
              <Select value={form.worker_id} onValueChange={(value) => setForm({ ...form, worker_id: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("Unassigned")}</SelectItem>
                  {workers.map((worker) => (
                    <SelectItem key={worker.id} value={worker.id}>
                      {worker.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("Number")}</Label>
              <Select value={form.number_id} onValueChange={(value) => setForm({ ...form, number_id: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("Unassigned")}</SelectItem>
                  {numbers.map((number) => (
                    <SelectItem key={number.id} value={number.id}>
                      {number.label} · {number.phone_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("Voice")}</Label>
              <Select value={form.voice} onValueChange={(value) => setForm({ ...form, voice: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {t(item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("Language")}</Label>
              <Select value={form.language} onValueChange={(value) => setForm({ ...form, language: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_LANGUAGES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("Accent")}</Label>
              <Select value={form.accent} onValueChange={(value) => setForm({ ...form, accent: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_ACCENTS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {t(item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("Recording policy")}</Label>
              <Select
                value={form.recording_policy}
                onValueChange={(value) => setForm({ ...form, recording_policy: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECORDING_POLICIES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {t(item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="silence">{t("Silence timeout (seconds)")}</Label>
              <Input
                id="silence"
                type="number"
                min={1}
                value={form.silence_timeout_seconds}
                onChange={(event) =>
                  setForm({ ...form, silence_timeout_seconds: Number(event.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-duration">{t("Max call duration (seconds)")}</Label>
              <Input
                id="max-duration"
                type="number"
                min={30}
                value={form.max_call_duration_seconds}
                onChange={(event) =>
                  setForm({ ...form, max_call_duration_seconds: Number(event.target.value) })
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="greeting">{t("Greeting")}</Label>
              <Textarea
                id="greeting"
                rows={2}
                value={form.greeting}
                onChange={(event) => setForm({ ...form, greeting: event.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="transfer">{t("Transfer rules")}</Label>
              <Input
                id="transfer"
                value={form.transfer_rules}
                onChange={(event) => setForm({ ...form, transfer_rules: event.target.value })}
                placeholder={t("comma,separated")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={submit}>{t("Save profile")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
