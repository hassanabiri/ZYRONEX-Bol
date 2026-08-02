import { useMemo, useState } from "react";
import { Gauge } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
import { useI18n } from "@/lib/i18n";
import { USAGE_CATEGORIES, USAGE_CATEGORY_MAP, formatMoney } from "@/lib/billing/catalog";
import { billingService, type UsageRecord } from "@/services/billing-service";

/** Usage Tracking: metered consumption for workers, voice, API, knowledge, memory and storage. */
export function UsageTracking({
  usage,
  currency = "USD",
}: {
  usage: UsageRecord[];
  currency?: string;
}) {
  const { t } = useI18n();
  const [category, setCategory] = useState("all");

  const grouped = useMemo(() => billingService.usageByCategory(usage), [usage]);
  const totalCost = usage.reduce((sum, record) => sum + Number(record.total_cost), 0);
  const rows = usage.filter((record) => category === "all" || record.category === category);

  if (usage.length === 0) {
    return (
      <EmptyState
        icon={Gauge}
        title="No usage recorded"
        description="Metered usage is written by each module as workers run, calls connect and documents index."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {USAGE_CATEGORIES.map((item) => {
          const entry = grouped.get(item.value);
          const share = totalCost ? ((entry?.cost ?? 0) / totalCost) * 100 : 0;
          return (
            <Card key={item.value}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t(item.label)}</CardTitle>
                <CardDescription className="text-xs">
                  {(entry?.quantity ?? 0).toLocaleString()} {entry?.unit ?? ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xl font-semibold">{formatMoney(entry?.cost ?? 0, currency)}</p>
                <Progress value={share} />
                <p className="text-xs text-muted-foreground">
                  {share.toFixed(1)}% {t("of period spend")}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All categories")}</SelectItem>
            {USAGE_CATEGORIES.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {t(item.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Date")}</TableHead>
                  <TableHead>{t("Category")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("Reference")}</TableHead>
                  <TableHead className="text-right">{t("Quantity")}</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">{t("Unit cost")}</TableHead>
                  <TableHead className="text-right">{t("Total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {record.occurred_on}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t(USAGE_CATEGORY_MAP.get(record.category)?.label ?? record.category)}
                    </TableCell>
                    <TableCell className="hidden max-w-64 truncate text-xs text-muted-foreground md:table-cell">
                      {record.reference_type ?? "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {Number(record.quantity).toLocaleString()} {record.unit}
                    </TableCell>
                    <TableCell className="hidden text-right text-xs lg:table-cell">
                      {formatMoney(Number(record.unit_cost), currency)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {formatMoney(Number(record.total_cost), currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
