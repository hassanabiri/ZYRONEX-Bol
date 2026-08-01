import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { workspaceService } from "@/services/workspace-service";
import type { Workspace } from "@/services/types";

export type { Workspace };

type WorkspaceContextValue = {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  setActiveWorkspaceId: (id: string) => void;
  isLoading: boolean;
  refresh: () => void;
};

const STORAGE_KEY = "zyronex.workspace";

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["workspaces", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => workspaceService.list(),
  });

  const workspaces = useMemo(() => data ?? [], [data]);

  // Realtime: keep the workspace list in sync across sessions.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel("workspaces-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "workspaces" }, () => {
        queryClient.invalidateQueries({ queryKey: ["workspaces", user.id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "workspace_members" }, () => {
        queryClient.invalidateQueries({ queryKey: ["workspaces", user.id] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  useEffect(() => {
    const first = workspaces[0];
    if (!first) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const valid = workspaces.find((workspace) => workspace.id === (activeId ?? stored));
    setActiveId((valid ?? first).id);
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
      refresh: () => {
        queryClient.invalidateQueries({ queryKey: ["workspaces", user?.id] });
      },
    };
  }, [workspaces, activeId, isLoading, queryClient, user?.id]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return context;
}
