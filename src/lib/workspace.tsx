import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  plan: string;
};

type WorkspaceContextValue = {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  setActiveWorkspaceId: (id: string) => void;
  isLoading: boolean;
};

const STORAGE_KEY = "zyronex.workspace";

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["workspaces", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<Workspace[]> => {
      const { data, error } = await supabase
        .from("workspaces")
        .select("id, name, slug, plan")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const workspaces = useMemo(() => data ?? [], [data]);

  useEffect(() => {
    if (!workspaces.length) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const valid = workspaces.find((workspace) => workspace.id === (activeId ?? stored));
    setActiveId((valid ?? workspaces[0]).id);
  }, [workspaces, activeId]);

  const value = useMemo<WorkspaceContextValue>(() => {
    const activeWorkspace = workspaces.find((workspace) => workspace.id === activeId) ?? null;
    return {
      workspaces,
      activeWorkspace,
      isLoading,
      setActiveWorkspaceId: (id: string) => {
        window.localStorage.setItem(STORAGE_KEY, id);
        setActiveId(id);
      },
    };
  }, [workspaces, activeId, isLoading]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return context;
}
