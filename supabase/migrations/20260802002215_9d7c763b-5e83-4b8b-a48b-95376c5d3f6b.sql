
-- ENUMS
CREATE TYPE public.knowledge_status AS ENUM ('draft','active','archived');
CREATE TYPE public.knowledge_source AS ENUM ('pdf','word','excel','csv','txt','markdown','website','faq','manual','database','api','cloud_storage','notion','google_drive');
CREATE TYPE public.document_status AS ENUM ('uploaded','scanning','extracting','cleaning','chunking','embedding_ready','indexed','available','failed','reindex');
CREATE TYPE public.memory_layer AS ENUM ('short_term','long_term','session','persistent');
CREATE TYPE public.memory_entry_status AS ENUM ('active','archived','expired');
CREATE TYPE public.memory_event_type AS ENUM ('created','updated','used','archived','expired','merged','summarized','deleted');
CREATE TYPE public.prompt_scope AS ENUM ('workspace','worker','system','shared');

-- WORKER MEMORY SETTINGS
ALTER TABLE public.ai_workers
  ADD COLUMN IF NOT EXISTS memory_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS memory_size integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS memory_retention_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS memory_type public.memory_layer NOT NULL DEFAULT 'short_term',
  ADD COLUMN IF NOT EXISTS memory_priority integer NOT NULL DEFAULT 5;

-- KNOWLEDGE BASES
CREATE TABLE public.knowledge_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general',
  tags text[] NOT NULL DEFAULT '{}',
  status public.knowledge_status NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_bases TO authenticated;
GRANT ALL ON public.knowledge_bases TO service_role;
ALTER TABLE public.knowledge_bases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kb read" ON public.knowledge_bases FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "kb write" ON public.knowledge_bases FOR INSERT TO authenticated WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE POLICY "kb update" ON public.knowledge_bases FOR UPDATE TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE POLICY "kb delete" ON public.knowledge_bases FOR DELETE TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER update_kb_updated_at BEFORE UPDATE ON public.knowledge_bases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- KNOWLEDGE FOLDERS
CREATE TABLE public.knowledge_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.knowledge_folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_folders TO authenticated;
GRANT ALL ON public.knowledge_folders TO service_role;
ALTER TABLE public.knowledge_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "folder read" ON public.knowledge_folders FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "folder manage" ON public.knowledge_folders FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER update_folder_updated_at BEFORE UPDATE ON public.knowledge_folders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- KNOWLEDGE DOCUMENTS
CREATE TABLE public.knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES public.knowledge_folders(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  source public.knowledge_source NOT NULL DEFAULT 'manual',
  source_url text,
  storage_path text,
  mime_type text,
  size_bytes bigint NOT NULL DEFAULT 0,
  content text,
  status public.document_status NOT NULL DEFAULT 'uploaded',
  error text,
  chunk_count integer NOT NULL DEFAULT 0,
  token_estimate integer NOT NULL DEFAULT 0,
  tags text[] NOT NULL DEFAULT '{}',
  archived boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  indexed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_documents_kb_idx ON public.knowledge_documents (knowledge_base_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_documents TO authenticated;
GRANT ALL ON public.knowledge_documents TO service_role;
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "doc read" ON public.knowledge_documents FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "doc manage" ON public.knowledge_documents FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER update_doc_updated_at BEFORE UPDATE ON public.knowledge_documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- DOCUMENT VERSIONS
CREATE TABLE public.knowledge_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  version integer NOT NULL,
  label text,
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.knowledge_document_versions TO authenticated;
GRANT ALL ON public.knowledge_document_versions TO service_role;
ALTER TABLE public.knowledge_document_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "docver read" ON public.knowledge_document_versions FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "docver write" ON public.knowledge_document_versions FOR INSERT TO authenticated WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));

-- KNOWLEDGE BASE VERSIONS
CREATE TABLE public.knowledge_base_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
  version integer NOT NULL,
  label text,
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.knowledge_base_versions TO authenticated;
GRANT ALL ON public.knowledge_base_versions TO service_role;
ALTER TABLE public.knowledge_base_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kbver read" ON public.knowledge_base_versions FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "kbver write" ON public.knowledge_base_versions FOR INSERT TO authenticated WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));

-- WORKER KNOWLEDGE ASSIGNMENT
CREATE TABLE public.worker_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.ai_workers(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (worker_id, knowledge_base_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_knowledge TO authenticated;
GRANT ALL ON public.worker_knowledge TO service_role;
ALTER TABLE public.worker_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wk read" ON public.worker_knowledge FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "wk manage" ON public.worker_knowledge FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER update_wk_updated_at BEFORE UPDATE ON public.worker_knowledge FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- MEMORY STORES
CREATE TABLE public.memory_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES public.ai_workers(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  layer public.memory_layer NOT NULL DEFAULT 'short_term',
  enabled boolean NOT NULL DEFAULT true,
  max_items integer NOT NULL DEFAULT 100,
  retention_days integer NOT NULL DEFAULT 30,
  priority integer NOT NULL DEFAULT 5,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_stores TO authenticated;
GRANT ALL ON public.memory_stores TO service_role;
ALTER TABLE public.memory_stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ms read" ON public.memory_stores FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "ms manage" ON public.memory_stores FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER update_ms_updated_at BEFORE UPDATE ON public.memory_stores FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- MEMORY ENTRIES
CREATE TABLE public.memory_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.memory_stores(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES public.ai_workers(id) ON DELETE SET NULL,
  key text NOT NULL,
  content text NOT NULL,
  importance integer NOT NULL DEFAULT 5,
  status public.memory_entry_status NOT NULL DEFAULT 'active',
  read_count integer NOT NULL DEFAULT 0,
  write_count integer NOT NULL DEFAULT 1,
  size_bytes integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_entries_store_idx ON public.memory_entries (store_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_entries TO authenticated;
GRANT ALL ON public.memory_entries TO service_role;
ALTER TABLE public.memory_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "me read" ON public.memory_entries FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "me manage" ON public.memory_entries FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER update_me_updated_at BEFORE UPDATE ON public.memory_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- MEMORY EVENTS
CREATE TABLE public.memory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.memory_stores(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES public.memory_entries(id) ON DELETE SET NULL,
  worker_id uuid REFERENCES public.ai_workers(id) ON DELETE SET NULL,
  event public.memory_event_type NOT NULL,
  detail text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.memory_events TO authenticated;
GRANT ALL ON public.memory_events TO service_role;
ALTER TABLE public.memory_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mev read" ON public.memory_events FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "mev write" ON public.memory_events FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

-- PROMPTS
CREATE TABLE public.prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES public.ai_workers(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  scope public.prompt_scope NOT NULL DEFAULT 'workspace',
  category text NOT NULL DEFAULT 'general',
  body text NOT NULL DEFAULT '',
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  is_template boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prompts TO authenticated;
GRANT ALL ON public.prompts TO service_role;
ALTER TABLE public.prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prompt read" ON public.prompts FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "prompt manage" ON public.prompts FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER update_prompt_updated_at BEFORE UPDATE ON public.prompts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PROMPT VERSIONS
CREATE TABLE public.prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  prompt_id uuid NOT NULL REFERENCES public.prompts(id) ON DELETE CASCADE,
  version integer NOT NULL,
  label text,
  body text NOT NULL,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.prompt_versions TO authenticated;
GRANT ALL ON public.prompt_versions TO service_role;
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pver read" ON public.prompt_versions FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "pver write" ON public.prompt_versions FOR INSERT TO authenticated WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));

-- MODEL CONFIGURATIONS
CREATE TABLE public.model_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES public.ai_workers(id) ON DELETE CASCADE,
  name text NOT NULL,
  provider text NOT NULL DEFAULT 'lovable',
  model text NOT NULL DEFAULT 'google/gemini-2.5-flash',
  temperature numeric NOT NULL DEFAULT 0.7,
  max_tokens integer NOT NULL DEFAULT 2048,
  top_p numeric NOT NULL DEFAULT 1,
  presence_penalty numeric NOT NULL DEFAULT 0,
  frequency_penalty numeric NOT NULL DEFAULT 0,
  stop_sequences text[] NOT NULL DEFAULT '{}',
  streaming boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_configs TO authenticated;
GRANT ALL ON public.model_configs TO service_role;
ALTER TABLE public.model_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mc read" ON public.model_configs FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "mc manage" ON public.model_configs FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER update_mc_updated_at BEFORE UPDATE ON public.model_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
