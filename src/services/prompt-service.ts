import { supabase } from "@/integrations/supabase/client";
import type { Enums, Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { activityService } from "@/services/activity-service";

export type Prompt = Tables<"prompts">;
export type PromptVersion = Tables<"prompt_versions">;
export type ModelConfig = Tables<"model_configs">;
export type PromptScope = Enums<"prompt_scope">;

export type PromptInsert = Omit<TablesInsert<"prompts">, "workspace_id" | "created_by">;
export type PromptPatch = TablesUpdate<"prompts">;
export type ModelConfigInsert = Omit<TablesInsert<"model_configs">, "workspace_id" | "created_by">;
export type ModelConfigPatch = TablesUpdate<"model_configs">;

export const PROMPT_SCOPES: PromptScope[] = ["workspace", "worker", "system", "shared"];

export const PROMPT_CATEGORIES = [
  "general",
  "system",
  "support",
  "sales",
  "research",
  "summarization",
  "extraction",
  "classification",
];

/** Extracts {{variable}} placeholders from a prompt body. */
export function extractVariables(body: string): string[] {
  const matches = body.matchAll(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1] ?? "").filter(Boolean)));
}

export const promptService = {
  async list(workspaceId: string): Promise<Prompt[]> {
    const { data, error } = await supabase
      .from("prompts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async create(workspaceId: string, input: PromptInsert, actorId?: string): Promise<Prompt> {
    const { data, error } = await supabase
      .from("prompts")
      .insert({
        ...input,
        variables: extractVariables(input.body ?? ""),
        workspace_id: workspaceId,
        created_by: actorId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    await promptService.snapshot(data, actorId, "Initial version");
    await activityService.log(workspaceId, {
      actor_id: actorId ?? null,
      entity_type: "prompt",
      entity_id: data.id,
      action: "prompt.created",
      detail: `Prompt "${data.name}" created`,
      result: "success",
    });
    return data;
  },

  async update(promptId: string, patch: PromptPatch, actorId?: string): Promise<Prompt> {
    const { data, error } = await supabase
      .from("prompts")
      .update({
        ...patch,
        ...(typeof patch.body === "string" ? { variables: extractVariables(patch.body) } : {}),
      })
      .eq("id", promptId)
      .select("*")
      .single();
    if (error) throw error;
    if (typeof patch.body === "string") await promptService.snapshot(data, actorId);
    return data;
  },

  async remove(promptId: string) {
    const { error } = await supabase.from("prompts").delete().eq("id", promptId);
    if (error) throw error;
  },

  async duplicate(prompt: Prompt, actorId?: string) {
    return promptService.create(
      prompt.workspace_id,
      {
        name: `${prompt.name} (copy)`,
        description: prompt.description,
        scope: prompt.scope,
        category: prompt.category,
        body: prompt.body,
        tags: prompt.tags,
        worker_id: prompt.worker_id,
        is_template: prompt.is_template,
      },
      actorId,
    );
  },

  async listVersions(promptId: string): Promise<PromptVersion[]> {
    const { data, error } = await supabase
      .from("prompt_versions")
      .select("*")
      .eq("prompt_id", promptId)
      .order("version", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async snapshot(prompt: Prompt, actorId?: string, label?: string) {
    const versions = await promptService.listVersions(prompt.id).catch(() => []);
    const next = (versions[0]?.version ?? 0) + 1;
    const { error } = await supabase.from("prompt_versions").insert({
      workspace_id: prompt.workspace_id,
      prompt_id: prompt.id,
      version: next,
      label: label ?? `Version ${next}`,
      body: prompt.body,
      variables: prompt.variables,
      created_by: actorId ?? null,
    });
    if (error) throw error;
    await supabase.from("prompts").update({ version: next }).eq("id", prompt.id);
  },

  async restoreVersion(prompt: Prompt, version: PromptVersion, actorId?: string) {
    return promptService.update(prompt.id, { body: version.body }, actorId);
  },
};

export const modelConfigService = {
  async list(workspaceId: string): Promise<ModelConfig[]> {
    const { data, error } = await supabase
      .from("model_configs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async create(workspaceId: string, input: ModelConfigInsert, actorId?: string) {
    const { data, error } = await supabase
      .from("model_configs")
      .insert({ ...input, workspace_id: workspaceId, created_by: actorId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async update(configId: string, patch: ModelConfigPatch) {
    const { data, error } = await supabase
      .from("model_configs")
      .update(patch)
      .eq("id", configId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async remove(configId: string) {
    const { error } = await supabase.from("model_configs").delete().eq("id", configId);
    if (error) throw error;
  },
};
