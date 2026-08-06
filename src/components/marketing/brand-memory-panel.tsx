import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBrandProfile, useMarketingMutations } from "@/hooks/use-marketing";
import { useI18n } from "@/lib/i18n";

/** Brand memory: the shared identity every creative worker must respect. */
export function BrandMemoryPanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const { data: brand } = useBrandProfile(workspaceId);
  const mutations = useMarketingMutations(workspaceId);

  const [form, setForm] = useState({
    brand_name: "",
    tone: "",
    voice: "",
    writing_style: "",
    guidelines: "",
    keywords: "",
  });

  useEffect(() => {
    if (!brand) return;
    setForm({
      brand_name: brand.brand_name ?? "",
      tone: brand.tone ?? "",
      voice: brand.voice ?? "",
      writing_style: brand.writing_style ?? "",
      guidelines: brand.guidelines ?? "",
      keywords: (brand.keywords ?? []).join(", "),
    });
  }, [brand]);

  async function save() {
    await mutations.saveBrand.mutateAsync({
      brand_name: form.brand_name || null,
      tone: form.tone || null,
      voice: form.voice || null,
      writing_style: form.writing_style || null,
      guidelines: form.guidelines || null,
      keywords: form.keywords
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    });
    toast.success(t("Brand memory saved"));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Fingerprint className="size-4" />
          {t("Brand memory")}
        </CardTitle>
        <CardDescription>
          {t("Shared identity injected into every creative brief so output stays on-brand.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("Brand name")}</Label>
            <Input
              value={form.brand_name}
              onChange={(event) => setForm({ ...form, brand_name: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("Tone")}</Label>
            <Input value={form.tone} onChange={(event) => setForm({ ...form, tone: event.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("Voice")}</Label>
            <Input value={form.voice} onChange={(event) => setForm({ ...form, voice: event.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("Writing style")}</Label>
            <Input
              value={form.writing_style}
              onChange={(event) => setForm({ ...form, writing_style: event.target.value })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>{t("Keywords")}</Label>
          <Input
            value={form.keywords}
            onChange={(event) => setForm({ ...form, keywords: event.target.value })}
            placeholder={t("Comma separated")}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("Guidelines")}</Label>
          <Textarea
            rows={4}
            value={form.guidelines}
            onChange={(event) => setForm({ ...form, guidelines: event.target.value })}
          />
        </div>
        <Button onClick={save} disabled={!canManage || mutations.saveBrand.isPending}>
          {t("Save brand memory")}
        </Button>
      </CardContent>
    </Card>
  );
}
