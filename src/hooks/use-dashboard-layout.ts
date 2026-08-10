import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { layoutService, type CardSize, type LayoutItem } from "@/services/layout-service";

export type { CardSize, LayoutItem };

export const layoutKeys = {
  dashboard: (userId: string, workspaceId: string) =>
    ["dashboard-layout", userId, workspaceId] as const,
};

/** Merge the saved layout with the current card catalog (new cards appended, stale ones dropped). */
export function mergeLayout(saved: LayoutItem[], defaults: LayoutItem[]): LayoutItem[] {
  const known = new Map(defaults.map((item) => [item.id, item]));
  const merged: LayoutItem[] = [];
  for (const item of saved) {
    const base = known.get(item.id);
    if (!base) continue;
    merged.push({ id: item.id, size: item.size, hidden: item.hidden === true });
    known.delete(item.id);
  }
  for (const item of defaults) {
    if (known.has(item.id)) merged.push(item);
  }
  return merged;
}

/**
 * Per-user dashboard layout: loads the saved arrangement, keeps a local optimistic
 * copy while the user drags/resizes, and persists changes (debounced) to the backend.
 */
export function useDashboardLayout(workspaceId: string | undefined, defaults: LayoutItem[]) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;
  const wsId = workspaceId ?? null;

  const query = useQuery({
    queryKey: layoutKeys.dashboard(userId ?? "none", workspaceId ?? "none"),
    enabled: Boolean(userId),
    queryFn: () => layoutService.get(userId!, wsId),
  });

  const [layout, setLayout] = useState<LayoutItem[]>(() => defaults);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLayout(mergeLayout(query.data ?? [], defaults));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, workspaceId]);

  const save = useMutation({
    mutationFn: (next: LayoutItem[]) => layoutService.save(userId!, wsId, next),
    onSuccess: (_data, next) => {
      queryClient.setQueryData(layoutKeys.dashboard(userId ?? "none", workspaceId ?? "none"), next);
    },
  });

  const persist = useCallback(
    (next: LayoutItem[]) => {
      setLayout(next);
      if (!userId) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => save.mutate(next), 500);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId],
  );

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  const reset = useCallback(async () => {
    setLayout(defaults);
    if (!userId) return;
    if (timer.current) clearTimeout(timer.current);
    await layoutService.reset(userId, wsId);
    queryClient.setQueryData(layoutKeys.dashboard(userId, workspaceId ?? "none"), []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, wsId, workspaceId, defaults, queryClient]);

  return { layout, setLayout: persist, reset, isLoading: query.isLoading, isSaving: save.isPending };
}
