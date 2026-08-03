import { toast } from "sonner";
import { PackageOpen, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useMarketplaceCatalogue,
  useMarketplaceInstalls,
  useMarketplaceMutations,
} from "@/hooks/use-marketplace";
import { useI18n } from "@/lib/i18n";

/** Everything this workspace has installed from the marketplace. */
export function InstallsPanel({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: installs = [], isLoading } = useMarketplaceInstalls(workspaceId);
  const { data: catalogue = [] } = useMarketplaceCatalogue();
  const mutations = useMarketplaceMutations(workspaceId);

  const nameFor = (productId: string) =>
    catalogue.find((product) => product.id === productId)?.name ?? productId;

  if (!isLoading && installs.length === 0) {
    return (
      <EmptyState
        icon={PackageOpen}
        title="No installs yet"
        description="Install a marketplace product to see it listed here."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Product")}</TableHead>
            <TableHead>{t("Version")}</TableHead>
            <TableHead>{t("License")}</TableHead>
            <TableHead>{t("Status")}</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {installs.map((install) => (
            <TableRow key={install.id}>
              <TableCell className="font-medium">{nameFor(install.product_id)}</TableCell>
              <TableCell className="tabular-nums">v{install.version}</TableCell>
              <TableCell>{t(install.license)}</TableCell>
              <TableCell>
                <Badge variant={install.status === "installed" ? "default" : "outline"}>
                  {t(install.status)}
                </Badge>
              </TableCell>
              <TableCell className="text-end">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  aria-label={t("Uninstall")}
                  onClick={async () => {
                    try {
                      await mutations.uninstallProduct.mutateAsync(install.id);
                      toast.success(t("Product uninstalled"));
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : t("Action failed"));
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
