import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { nodeSpec } from "@/lib/execution/nodes";
import type { WorkflowNode } from "@/lib/execution/graph";
import { useI18n } from "@/lib/i18n";

export function NodeInspector({
  node,
  onChange,
  onDelete,
  readOnly,
}: {
  node: WorkflowNode;
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const spec = nodeSpec(String(node.kind));

  const setParam = (key: string, value: string | number | boolean) =>
    onChange({ ...node, params: { ...node.params, [key]: value } });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs">{t("Label")}</Label>
        <Input
          value={node.label}
          disabled={readOnly}
          onChange={(event) => onChange({ ...node, label: event.target.value })}
        />
        <p className="text-[11px] text-muted-foreground">{t(spec.description)}</p>
      </div>

      {spec.params.map((param) => {
        const value = node.params?.[param.key];
        return (
          <div key={param.key} className="space-y-2">
            <Label className="text-xs">
              {t(param.label)}
              {param.required && <span className="ms-1 text-destructive">*</span>}
            </Label>
            {param.type === "textarea" && (
              <Textarea
                rows={3}
                disabled={readOnly}
                value={String(value ?? "")}
                placeholder={param.placeholder ?? ""}
                onChange={(event) => setParam(param.key, event.target.value)}
              />
            )}
            {(param.type === "text" || param.type === "number") && (
              <Input
                type={param.type === "number" ? "number" : "text"}
                disabled={readOnly}
                value={String(value ?? "")}
                placeholder={param.placeholder ?? ""}
                onChange={(event) =>
                  setParam(
                    param.key,
                    param.type === "number" ? Number(event.target.value) : event.target.value,
                  )
                }
              />
            )}
            {param.type === "select" && (
              <Select
                disabled={readOnly}
                value={String(value ?? "")}
                onValueChange={(next) => setParam(param.key, next)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("Select")} />
                </SelectTrigger>
                <SelectContent>
                  {(param.options ?? []).map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {param.type === "boolean" && (
              <Switch
                disabled={readOnly}
                checked={Boolean(value)}
                onCheckedChange={(next) => setParam(param.key, next)}
              />
            )}
          </div>
        );
      })}

      {!readOnly && (
        <Button variant="outline" className="w-full gap-2 text-destructive" onClick={onDelete}>
          <Trash2 className="size-4" />
          {t("Delete node")}
        </Button>
      )}
    </div>
  );
}
