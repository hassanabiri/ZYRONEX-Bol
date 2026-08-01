CREATE TYPE public.worker_status AS ENUM ('draft','active','paused','archived');

CREATE TABLE public.ai_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  avatar_url text,
  color text NOT NULL DEFAULT 'cyan',
  icon text NOT NULL DEFAULT 'bot',
  type text NOT NULL DEFAULT 'custom',
  purpose text NOT NULL DEFAULT 'custom',
  provider text NOT NULL DEFAULT 'custom',
  model text,
  language text NOT NULL DEFAULT 'en',
  timezone text NOT NULL DEFAULT 'UTC',
  region text NOT NULL DEFAULT 'us-east',
  status public.worker_status NOT NULL DEFAULT 'draft',
  tags text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_workers_workspace_idx ON public.ai_workers(workspace_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_workers TO authenticated;
GRANT ALL ON public.ai_workers TO service_role;
ALTER TABLE public.ai_workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY workers_select ON public.ai_workers FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY workers_write ON public.ai_workers FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::public.workspace_role[]));

CREATE TRIGGER ai_workers_updated_at BEFORE UPDATE ON public.ai_workers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.worker_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES public.ai_workers(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX worker_notes_worker_idx ON public.worker_notes(worker_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_notes TO authenticated;
GRANT ALL ON public.worker_notes TO service_role;
ALTER TABLE public.worker_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY worker_notes_select ON public.worker_notes FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY worker_notes_insert ON public.worker_notes FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::public.workspace_role[]));
CREATE POLICY worker_notes_update ON public.worker_notes FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::public.workspace_role[]))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY worker_notes_delete ON public.worker_notes FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::public.workspace_role[]));

CREATE TABLE public.worker_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES public.ai_workers(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX worker_activity_worker_idx ON public.worker_activity(worker_id);
GRANT SELECT, INSERT ON public.worker_activity TO authenticated;
GRANT ALL ON public.worker_activity TO service_role;
ALTER TABLE public.worker_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY worker_activity_select ON public.worker_activity FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY worker_activity_insert ON public.worker_activity FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::public.workspace_role[]));

CREATE TABLE public.worker_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES public.ai_workers(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  label text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (worker_id, version)
);
CREATE INDEX worker_versions_worker_idx ON public.worker_versions(worker_id);
GRANT SELECT, INSERT ON public.worker_versions TO authenticated;
GRANT ALL ON public.worker_versions TO service_role;
ALTER TABLE public.worker_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY worker_versions_select ON public.worker_versions FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY worker_versions_insert ON public.worker_versions FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::public.workspace_role[]));