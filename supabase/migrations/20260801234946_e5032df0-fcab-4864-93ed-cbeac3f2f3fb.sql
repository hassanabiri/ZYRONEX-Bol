
CREATE TYPE public.workflow_status AS ENUM ('draft','published','paused','archived');
CREATE TYPE public.execution_status AS ENUM ('waiting','queued','running','completed','failed','cancelled','retrying');

-- 1. workflows
CREATE TABLE public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status public.workflow_status NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  graph jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  published_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflows TO authenticated;
GRANT ALL ON public.workflows TO service_role;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read workflows" ON public.workflows FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Editors insert workflows" ON public.workflows FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE POLICY "Editors update workflows" ON public.workflows FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE POLICY "Admins delete workflows" ON public.workflows FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX workflows_workspace_idx ON public.workflows(workspace_id, updated_at DESC);

-- 2. workflow_versions
CREATE TABLE public.workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version integer NOT NULL,
  label text,
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.workflow_versions TO authenticated;
GRANT ALL ON public.workflow_versions TO service_role;
ALTER TABLE public.workflow_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read workflow versions" ON public.workflow_versions FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Editors insert workflow versions" ON public.workflow_versions FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE INDEX workflow_versions_workflow_idx ON public.workflow_versions(workflow_id, version DESC);

-- 3. workflow_workers
CREATE TABLE public.workflow_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.ai_workers(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, worker_id)
);
GRANT SELECT, INSERT, DELETE ON public.workflow_workers TO authenticated;
GRANT ALL ON public.workflow_workers TO service_role;
ALTER TABLE public.workflow_workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read workflow workers" ON public.workflow_workers FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Editors manage workflow workers" ON public.workflow_workers FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE POLICY "Editors remove workflow workers" ON public.workflow_workers FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));

-- 4. executions
CREATE TABLE public.executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES public.workflows(id) ON DELETE SET NULL,
  worker_id uuid REFERENCES public.ai_workers(id) ON DELETE SET NULL,
  workflow_version integer,
  status public.execution_status NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 5,
  attempt integer NOT NULL DEFAULT 1,
  max_attempts integer NOT NULL DEFAULT 1,
  timeout_seconds integer NOT NULL DEFAULT 300,
  trigger text NOT NULL DEFAULT 'manual',
  progress integer NOT NULL DEFAULT 0,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error text,
  warnings text[] NOT NULL DEFAULT '{}',
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.executions TO authenticated;
GRANT ALL ON public.executions TO service_role;
ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read executions" ON public.executions FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Editors insert executions" ON public.executions FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE POLICY "Editors update executions" ON public.executions FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER update_executions_updated_at BEFORE UPDATE ON public.executions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX executions_workspace_idx ON public.executions(workspace_id, created_at DESC);
CREATE INDEX executions_status_idx ON public.executions(workspace_id, status, priority DESC);

-- 5. execution_steps
CREATE TABLE public.execution_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.executions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  node_type text NOT NULL,
  label text,
  seq integer NOT NULL DEFAULT 0,
  status public.execution_status NOT NULL DEFAULT 'waiting',
  attempt integer NOT NULL DEFAULT 1,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  output jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.execution_steps TO authenticated;
GRANT ALL ON public.execution_steps TO service_role;
ALTER TABLE public.execution_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read execution steps" ON public.execution_steps FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Editors insert execution steps" ON public.execution_steps FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE POLICY "Editors update execution steps" ON public.execution_steps FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE INDEX execution_steps_execution_idx ON public.execution_steps(execution_id, seq);

-- 6. activity_log
CREATE TABLE public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  worker_id uuid REFERENCES public.ai_workers(id) ON DELETE SET NULL,
  workflow_id uuid REFERENCES public.workflows(id) ON DELETE SET NULL,
  execution_id uuid REFERENCES public.executions(id) ON DELETE SET NULL,
  entity_type text NOT NULL DEFAULT 'workspace',
  entity_id uuid,
  action text NOT NULL,
  detail text,
  result text NOT NULL DEFAULT 'success',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read activity log" ON public.activity_log FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members write activity log" ON public.activity_log FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE INDEX activity_log_workspace_idx ON public.activity_log(workspace_id, created_at DESC);

-- 7. worker runtime settings
ALTER TABLE public.ai_workers
  ADD COLUMN execution_timeout_seconds integer NOT NULL DEFAULT 300,
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN priority integer NOT NULL DEFAULT 5,
  ADD COLUMN concurrency_limit integer NOT NULL DEFAULT 1,
  ADD COLUMN execution_mode text NOT NULL DEFAULT 'manual';
