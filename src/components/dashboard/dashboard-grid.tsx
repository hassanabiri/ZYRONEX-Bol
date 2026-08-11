import { useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical, Maximize2, Minimize2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CardSize, LayoutItem } from "@/services/layout-service";

const SPAN: Record<CardSize, string> = {
  1: "col-span-1",
  2: "col-span-1 sm:col-span-2",
  3: "col-span-1 sm:col-span-2 xl:col-span-3",
};

function SortableCard({
  item,
  title,
  children,
  editing,
  onResize,
  onToggleHidden,
}: {
  item: LayoutItem;
  title: string;
  children: ReactNode;
  editing: boolean;
  onResize: (size: CardSize) => void;
  onToggleHidden: () => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !editing,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group relative min-w-0",
        SPAN[item.size],
        isDragging && "z-20 opacity-80",
        editing && "rounded-xl ring-1 ring-primary/25",
        item.hidden && "opacity-45",
      )}
    >
      {editing ? (
        <div className="absolute inset-x-0 top-1 z-20 flex justify-center px-1">
          <div className="flex max-w-full items-center gap-0.5 overflow-hidden rounded-full border bg-background/95 px-1 py-0.5 shadow-sm backdrop-blur">
            <button
              type="button"
              aria-label={`${t("Move")} ${title}`}
              className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-4" />
            </button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9 shrink-0 rounded-full"
              aria-label={t("Shrink card")}
              disabled={item.size === 1}
              onClick={() => onResize((item.size - 1) as CardSize)}
            >
              <Minimize2 className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9 shrink-0 rounded-full"
              aria-label={t("Enlarge card")}
              disabled={item.size === 3}
              onClick={() => onResize((item.size + 1) as CardSize)}
            >
              <Maximize2 className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9 shrink-0 rounded-full"
              aria-label={item.hidden ? t("Show card") : t("Hide card")}
              onClick={onToggleHidden}
            >
              {item.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
        </div>
      ) : null}
      <div className={cn("h-full", editing && "pointer-events-none select-none")}>{children}</div>
    </div>
  );
}

/**
 * Drag-and-drop, resizable dashboard grid. The parent owns the layout array and
 * persists it per user; this component only renders and emits changes.
 */
export function DashboardGrid({
  layout,
  cards,
  onChange,
  onReset,
  isSaving,
}: {
  layout: LayoutItem[];
  cards: Record<string, { title: string; node: ReactNode }>;
  onChange: (next: LayoutItem[]) => void;
  onReset: () => void;
  isSaving?: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const visible = useMemo(
    () => layout.filter((item) => cards[item.id] && (editing || !item.hidden)),
    [layout, cards, editing],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = layout.findIndex((item) => item.id === active.id);
    const to = layout.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(layout, from, to));
  };

  const update = (id: string, patch: Partial<LayoutItem>) =>
    onChange(layout.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isSaving ? (
          <span className="text-xs text-muted-foreground">{t("Saving layout…")}</span>
        ) : null}
        {editing ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="sm" onClick={onReset}>
                <RotateCcw className="size-4" />
                {t("Reset layout")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("Restore the default dashboard arrangement")}</TooltipContent>
          </Tooltip>
        ) : null}
        <Button
          type="button"
          variant={editing ? "default" : "outline"}
          size="sm"
          onClick={() => setEditing((value) => !value)}
        >
          <GripVertical className="size-4" />
          {editing ? t("Done") : t("Customize layout")}
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={visible.map((item) => item.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((item) => (
              <SortableCard
                key={item.id}
                item={item}
                title={cards[item.id]!.title}
                editing={editing}
                onResize={(size) => update(item.id, { size })}
                onToggleHidden={() => update(item.id, { hidden: !item.hidden })}
              >
                {cards[item.id]!.node}
              </SortableCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
