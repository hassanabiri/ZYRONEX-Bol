-- 1. Workspace settings
CREATE TABLE public.workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  domain text,
  region text NOT NULL DEFAULT 'us-east',
  language text NOT NULL DEFAULT 'en',
  timezone text NOT NULL DEFAULT 'UTC',
  brand_color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_settings TO authenticated;
GRANT ALL ON public.workspace_settings TO service_role;
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_settings_select" ON public.workspace_settings FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "ws_settings_write" ON public.workspace_settings FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER trg_ws_settings_updated BEFORE UPDATE ON public.workspace_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Invitations
CREATE TABLE public.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'pending',
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_invitations TO authenticated;
GRANT ALL ON public.workspace_invitations TO service_role;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_invites_select" ON public.workspace_invitations FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "ws_invites_write" ON public.workspace_invitations FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER trg_ws_invites_updated BEFORE UPDATE ON public.workspace_invitations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Custom workspace roles
CREATE TABLE public.workspace_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_roles TO authenticated;
GRANT ALL ON public.workspace_roles TO service_role;
ALTER TABLE public.workspace_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_roles_select" ON public.workspace_roles FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "ws_roles_write" ON public.workspace_roles FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER trg_ws_roles_updated BEFORE UPDATE ON public.workspace_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Permissions granted to custom roles
CREATE TABLE public.workspace_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  workspace_role_id uuid NOT NULL REFERENCES public.workspace_roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_role_id, permission_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_role_permissions TO authenticated;
GRANT ALL ON public.workspace_role_permissions TO service_role;
ALTER TABLE public.workspace_role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_role_perms_select" ON public.workspace_role_permissions FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "ws_role_perms_write" ON public.workspace_role_permissions FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));

-- 5. Seed the permission catalog (module.action keys)
INSERT INTO public.permissions (key, description) VALUES
  ('workspace.view','View workspace'),
  ('workspace.update','Update workspace settings'),
  ('workspace.delete','Delete workspace'),
  ('workspace.members.manage','Manage team members'),
  ('workspace.roles.manage','Manage roles and permissions'),
  ('agents.view','View agents'),
  ('agents.create','Create agents'),
  ('agents.update','Update agents'),
  ('agents.delete','Delete agents'),
  ('workflow.view','View workflows'),
  ('workflow.create','Create workflows'),
  ('workflow.update','Update workflows'),
  ('workflow.delete','Delete workflows'),
  ('voice.view','View voice channels'),
  ('voice.manage','Manage voice channels'),
  ('knowledge.view','View knowledge bases'),
  ('knowledge.upload','Upload knowledge files'),
  ('knowledge.delete','Delete knowledge sources'),
  ('billing.view','View billing'),
  ('billing.manage','Manage subscription and payment'),
  ('developer.view','View developer center'),
  ('developer.keys.manage','Manage API keys'),
  ('administration.view','View administration'),
  ('administration.audit.view','View audit logs')
ON CONFLICT DO NOTHING;