import { useState } from "react";
import { Download, FileText, Plus } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBillingMutations } from "@/hooks/use-billing";
import { useI18n } from "@/lib/i18n";
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_TONE, formatMoney } from "@/lib/billing/catalog";
import {
  invoicesToCsv,
  type InvoiceWithItems,
  type Subscription,
  type UsageRecord,
} from "@/services/billing-service";

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Invoice Center: create drafts from usage, review lines, export and download. */
export function InvoiceCenter({
  workspaceId,
  subscription,
  invoices,
  usage,
  canManage,
}: {
  workspaceId: string | undefined;
  subscription: Subscription | null;
  invoices: InvoiceWithItems[];
  usage: UsageRecord[];
  canManage: boolean;
}) {
  const { t } = useI18n();
  const mutations = useBillingMutations(workspaceId);
  const [selected, setSelected] = useState<InvoiceWithItems | null>(null);

  async function generate() {
    try {
      await mutations.createInvoice.mutateAsync({ subscription, usage });
      toast.success(t("Draft invoice created"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          disabled={invoices.length === 0}
          onClick={() => download("invoices.csv", invoicesToCsv(invoices), "text/csv")}
        >
          <Download className="size-4" />
          {t("Export CSV")}
        </Button>
        {canManage && (
          <Button onClick={generate}>
            <Plus className="size-4" />
            {t("Create invoice from usage")}
          </Button>
        )}
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No invoices yet"
          description="Generate a draft invoice from the current period's metered usage and plan fee."
          action={canManage ? <Button onClick={generate}>{t("Create invoice")}</Button> : undefined}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Invoice")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Issued")}</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">{t("Tax")}</TableHead>
                    <TableHead className="text-right">{t("Total")}</TableHead>
                    <TableHead className="text-right">{t("Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="text-sm font-medium">{invoice.number}</TableCell>
                      <TableCell>
                        <Badge variant={INVOICE_STATUS_TONE[invoice.status]}>
                          {t(INVOICE_STATUS_LABELS[invoice.status])}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                        {invoice.issued_at ? new Date(invoice.issued_at).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="hidden text-right text-xs lg:table-cell">
                        {formatMoney(Number(invoice.tax_amount), invoice.currency)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatMoney(Number(invoice.total), invoice.currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setSelected(invoice)}>
                            {t("View")}
                          </Button>
                          {canManage && invoice.status === "draft" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                mutations.updateInvoice.mutate({
                                  invoice,
                                  patch: { status: "open" },
                                })
                              }
                            >
                              {t("Issue")}
                            </Button>
                          )}
                          {canManage && invoice.status === "open" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                mutations.updateInvoice.mutate({
                                  invoice,
                                  patch: { status: "paid", paid_at: new Date().toISOString() },
                                })
                              }
                            >
                              {t("Mark paid")}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.number}</DialogTitle>
            <DialogDescription>{t("Invoice lines and totals.")}</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Description")}</TableHead>
                    <TableHead className="text-right">{t("Qty")}</TableHead>
                    <TableHead className="text-right">{t("Amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm">{item.description}</TableCell>
                      <TableCell className="text-right text-sm">
                        {Number(item.quantity).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatMoney(Number(item.amount), selected.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("Subtotal")}</dt>
                  <dd>{formatMoney(Number(selected.subtotal), selected.currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    {t("Tax")} ({Number(selected.tax_rate)}%)
                  </dt>
                  <dd>{formatMoney(Number(selected.tax_amount), selected.currency)}</dd>
                </div>
                <div className="flex justify-between font-semibold">
                  <dt>{t("Total")}</dt>
                  <dd>{formatMoney(Number(selected.total), selected.currency)}</dd>
                </div>
              </dl>
              <Button
                variant="outline"
                className="w-full"
                onClick={() =>
                  download(
                    `${selected.number}.json`,
                    JSON.stringify(selected, null, 2),
                    "application/json",
                  )
                }
              >
                <Download className="size-4" />
                {t("Download invoice")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
