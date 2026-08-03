import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { randomToken, sha256, slugify } from "@/lib/utils";
import { activityService } from "@/services/activity-service";

export type DeveloperProject = Tables<"developer_projects">;
export type OAuthClient = Tables<"oauth_clients">;
export type EnvironmentVariable = Tables<"environment_variables">;
export type Plugin = Tables<"plugins">;

export type DeveloperProjectInsert = Omit<
  TablesInsert<"developer_projects">,
  "workspace_id" | "created_by" | "slug"
>;

/**
 * Developer Platform data layer: projects, OAuth applications, environment
 * variables and the plugin registry. Everything is workspace-scoped; RLS
 * mirrors the role checks used here.
 */
export const developerService = {
  // ------------------------------------------------------------- projects
  async listProjects(workspaceId: string): Promise<DeveloperProject[]> {
    const { data, error } = await supabase
      .from("developer_projects")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async createProject(workspaceId: string, input: DeveloperProjectInsert, userId?: string) {
    const { data, error } = await supabase
      .from("developer_projects")
      .insert({
        ...input,
        workspace_id: workspaceId,
        slug: `${slugify(input.name)}-${randomToken(2)}`,
        created_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(workspaceId, {
      entity_type: "developer_project",
      entity_id: data.id,
      action: "project.created",
      detail: data.name,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async updateProject(id: string, patch: TablesUpdate<"developer_projects">) {
    const { data, error } = await supabase
      .from("developer_projects")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async removeProject(id: string) {
    const { error } = await supabase.from("developer_projects").delete().eq("id", id);
    if (error) throw error;
  },

  // -------------------------------------------------------- oauth clients
  async listOAuthClients(workspaceId: string): Promise<OAuthClient[]> {
    const { data, error } = await supabase
      .from("oauth_clients")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  /** Returns the plaintext secret exactly once — only its hash is persisted. */
  async createOAuthClient(
    workspaceId: string,
    input: {
      name: string;
      projectId?: string | null;
      redirectUris: string[];
      scopes: string[];
      grantTypes: string[];
    },
    userId?: string,
  ) {
    const clientId = `zxc_${randomToken(10)}`;
    const secret = `zxs_${randomToken(24)}`;
    const { data, error } = await supabase
      .from("oauth_clients")
      .insert({
        workspace_id: workspaceId,
        project_id: input.projectId ?? null,
        name: input.name,
        client_id: clientId,
        secret_hash: await sha256(secret),
        secret_preview: `${secret.slice(0, 12)}…`,
        redirect_uris: input.redirectUris,
        scopes: input.scopes,
        grant_types: input.grantTypes,
        created_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return { client: data, secret };
  },

  async rotateOAuthSecret(clientId: string) {
    const secret = `zxs_${randomToken(24)}`;
    const { data, error } = await supabase
      .from("oauth_clients")
      .update({
        secret_hash: await sha256(secret),
        secret_preview: `${secret.slice(0, 12)}…`,
        last_rotated_at: new Date().toISOString(),
      })
      .eq("id", clientId)
      .select("*")
      .single();
    if (error) throw error;
    return { client: data, secret };
  },

  async updateOAuthClient(id: string, patch: TablesUpdate<"oauth_clients">) {
    const { data, error } = await supabase
      .from("oauth_clients")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async removeOAuthClient(id: string) {
    const { error } = await supabase.from("oauth_clients").delete().eq("id", id);
    if (error) throw error;
  },

  // ------------------------------------------------- environment variables
  async listEnvVars(workspaceId: string): Promise<EnvironmentVariable[]> {
    const { data, error } = await supabase
      .from("environment_variables")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("key");
    if (error) throw error;
    return data ?? [];
  },

  async upsertEnvVar(
    workspaceId: string,
    input: {
      key: string;
      value: string;
      isSecret: boolean;
      environment: string;
      projectId?: string | null;
    },
    userId?: string,
  ) {
    const { data, error } = await supabase
      .from("environment_variables")
      .insert({
        workspace_id: workspaceId,
        project_id: input.projectId ?? null,
        key: input.key.trim().toUpperCase(),
        value: input.value,
        is_secret: input.isSecret,
        environment: input.environment,
        created_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async removeEnvVar(id: string) {
    const { error } = await supabase.from("environment_variables").delete().eq("id", id);
    if (error) throw error;
  },

  // -------------------------------------------------------------- plugins
  async listPlugins(workspaceId: string): Promise<Plugin[]> {
    const { data, error } = await supabase
      .from("plugins")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async installPlugin(
    workspaceId: string,
    input: {
      name: string;
      publisher: string;
      description?: string | null;
      version?: string;
      permissions: string[];
      dependencies: string[];
    },
    userId?: string,
  ) {
    const version = input.version?.trim() || "1.0.0";
    const { data, error } = await supabase
      .from("plugins")
      .insert({
        workspace_id: workspaceId,
        name: input.name,
        slug: `${slugify(input.name)}-${randomToken(2)}`,
        publisher: input.publisher,
        description: input.description ?? null,
        version,
        latest_version: version,
        status: "enabled",
        permissions: input.permissions,
        dependencies: input.dependencies,
        installed_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(workspaceId, {
      entity_type: "plugin",
      entity_id: data.id,
      action: "plugin.installed",
      detail: data.name,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async setPluginStatus(plugin: Plugin, status: Plugin["status"], userId?: string) {
    const { data, error } = await supabase
      .from("plugins")
      .update({ status })
      .eq("id", plugin.id)
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(plugin.workspace_id, {
      entity_type: "plugin",
      entity_id: plugin.id,
      action: `plugin.${status}`,
      detail: plugin.name,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  /** Applies the available upgrade recorded on the plugin row. */
  async updatePlugin(plugin: Plugin) {
    const { data, error } = await supabase
      .from("plugins")
      .update({ version: plugin.latest_version, status: "enabled" })
      .eq("id", plugin.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async removePlugin(id: string) {
    const { error } = await supabase.from("plugins").delete().eq("id", id);
    if (error) throw error;
  },
};
