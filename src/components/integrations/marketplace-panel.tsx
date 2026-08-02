import { useState } from "react";
import { Download, Plus, Store, Trash2 } from "lucide-react";
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
import { useIntegrationMutations, useMarketplaceListings } from "@/hooks/use-integrations";
import { useI18n } from "@/lib/i18n";
import { INTEGRATION_CATEGORIES } from "@/lib/integrations/catalog";

/** Workspace marketplace of publishable connector packages. */
export function MarketplacePanel({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: listings = [], isLoading } = useMarketplaceListings(workspaceId);
  const mutations = useIntegrationMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [publisher, setPublisher] = useState("");
  const [category, setCategory] = useState<string>(INTEGRATION_CATEGORIES[0]?.id ?? "custom");
  const [description, setDescription] = useState("");

  async function run(label: string, action: Promise<unknown>) {
    try {
      await action;
      toast.success(t(label));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
      return false;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("Marketplace")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("Publish reusable connector packages and install them in one click.")}
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="me-2 size-4" />
          {t("Publish listing")}
        </Button>
      </div>

      {!isLoading && listings.length === 0 ? (
        <EmptyState
          icon={Store}
          title={t("Marketplace is empty")}
          description={t("Publish a connector package to share it across your workspace.")}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {listings.map((listing) => (
            <Card key={listing.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{listing.name}</CardTitle>
                  <Badge variant="outline">{listing.status}</Badge>
                </div>
                <CardDescription>
                  {listing.description ?? t("No description provided.")}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                <p className="text-xs text-muted-foreground">
                  {listing.publisher} · {listing.category} · {listing.install_count}{" "}
                  {t("installs")}
                </p>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() =>
                      void run("Connector installed", mutations.installListing.mutateAsync(listing))
                    }
                  >
                    <Download className="me-2 size-4" />
                    {t("Install")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() =>
                      void run("Listing removed", mutations.deleteListing.mutateAsync(listing.id))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Publish listing")}</DialogTitle>
            <DialogDescription>
              {t("Listings are scoped to this workspace and can be installed by members.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="listing-name">{t("Name")}</Label>
              <Input id="listing-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="listing-publisher">{t("Publisher")}</Label>
              <Input
                id="listing-publisher"
                value={publisher}
                onChange={(e) => setPublisher(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("Category")}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTEGRATION_CATEGORIES.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {t(item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="listing-desc">{t("Description")}</Label>
              <Textarea
                id="listing-desc"
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
            <Button
              disabled={!name.trim() || !publisher.trim()}
              onClick={async () => {
                const ok = await run(
                  "Listing published",
                  mutations.createListing.mutateAsync({
                    name: name.trim(),
                    publisher: publisher.trim(),
                    category,
                    description: description.trim() || null,
                  }),
                );
                if (ok) {
                  setOpen(false);
                  setName("");
                  setPublisher("");
                  setDescription("");
                }
              }}
            >
              {t("Publish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
