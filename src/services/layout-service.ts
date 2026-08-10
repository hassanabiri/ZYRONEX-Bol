import { supabase } from "@/integrations/supabase/client";

export type CardSize = 1 | 2 | 3;

export type LayoutItem = {
  id: string;
  size: CardSize;
  hidden?: boolean;
};

const SCOPE = "dashboard";

function parseLayout(value: unknown): LayoutItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string") return [];
    const size = Number(item.size);
    return [
      {
        id: item.id,
        size: (size === 1 || size === 2 || size === 3 ? size : 1) as CardSize,
        hidden: item.hidden === true,
      },
    ];
  });
}

/** Per-user (optionally per-workspace) persistence of dashboard card arrangement. */
export const layoutService = {
  async get(userId: string, workspaceId: string | null, scope = SCOPE): Promise<LayoutItem[]> {
    let query = supabase
      .from("dashboard_layouts")
      .select("layout")
      .eq("user_id", userId)
      .eq("scope", scope);

    query = workspaceId ? query.eq("workspace_id", workspaceId) : query.is("workspace_id", null);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return parseLayout(data?.layout);
  },

  async save(
    userId: string,
    workspaceId: string | null,
    layout: LayoutItem[],
    scope = SCOPE,
  ): Promise<void> {
    const { error } = await supabase.from("dashboard_layouts").upsert(
      {
        user_id: userId,
        workspace_id: workspaceId,
        scope,
        layout: layout as unknown as never,
      },
      { onConflict: "user_id,workspace_id,scope" },
    );
    if (error) throw error;
  },

  async reset(userId: string, workspaceId: string | null, scope = SCOPE): Promise<void> {
    let query = supabase
      .from("dashboard_layouts")
      .delete()
      .eq("user_id", userId)
      .eq("scope", scope);
    query = workspaceId ? query.eq("workspace_id", workspaceId) : query.is("workspace_id", null);
    const { error } = await query;
    if (error) throw error;
  },
};
