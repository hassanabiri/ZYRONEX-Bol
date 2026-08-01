-- profiles extensions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_login timestamptz;

-- workspaces extensions / renames
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS logo text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.workspaces RENAME COLUMN plan TO subscription_plan;
ALTER TABLE public.workspaces RENAME COLUMN created_by TO owner_user_id;

-- workspace_members extensions
ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- roles
CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.roles TO authenticated;
GRANT ALL ON public.roles TO service_role;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY roles_select_authenticated ON public.roles FOR SELECT TO authenticated USING (true);

-- permissions
CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.permissions TO authenticated;
GRANT ALL ON public.permissions TO service_role;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY permissions_select_authenticated ON public.permissions FOR SELECT TO authenticated USING (true);

-- role_permissions
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id)
);
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_select_authenticated ON public.role_permissions FOR SELECT TO authenticated USING (true);

-- workspace_members.role_id (primary role reference)
ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL;

-- member_roles
CREATE TABLE IF NOT EXISTS public.member_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.workspace_members(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, role_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_roles TO authenticated;
GRANT ALL ON public.member_roles TO service_role;
ALTER TABLE public.member_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.member_workspace(_member_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT workspace_id FROM public.workspace_members WHERE id = _member_id;
$$;

CREATE POLICY member_roles_select ON public.member_roles FOR SELECT TO authenticated
  USING (public.is_workspace_member(public.member_workspace(member_id), auth.uid()));
CREATE POLICY member_roles_write_admins ON public.member_roles FOR ALL TO authenticated
  USING (public.has_workspace_role(public.member_workspace(member_id), auth.uid(), ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(public.member_workspace(member_id), auth.uid(), ARRAY['owner','admin']::workspace_role[]));

-- seed reference data
INSERT INTO public.roles (name, description) VALUES
  ('owner', 'Full control of the workspace, including deletion and billing.'),
  ('admin', 'Manage members, agents and workspace configuration.'),
  ('member', 'Build and operate agents and workflows.'),
  ('viewer', 'Read-only access to workspace resources.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.permissions (key, description) VALUES
  ('workspace.read', 'View workspace details'),
  ('workspace.update', 'Update workspace settings'),
  ('workspace.delete', 'Delete the workspace'),
  ('members.read', 'View workspace members'),
  ('members.manage', 'Invite, update and remove members'),
  ('billing.read', 'View billing and usage'),
  ('billing.manage', 'Manage subscription and payment methods'),
  ('resources.read', 'View workspace resources'),
  ('resources.manage', 'Create and modify workspace resources')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.name = 'owner'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r JOIN public.permissions p ON p.key <> 'workspace.delete'
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r JOIN public.permissions p ON p.key IN ('workspace.read','members.read','resources.read','resources.manage')
WHERE r.name = 'member'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r JOIN public.permissions p ON p.key IN ('workspace.read','members.read','resources.read')
WHERE r.name = 'viewer'
ON CONFLICT DO NOTHING;

-- backfill existing members' role_id
UPDATE public.workspace_members m SET role_id = r.id
FROM public.roles r WHERE r.name = m.role::text AND m.role_id IS NULL;

-- backfill profile emails
UPDATE public.profiles p SET email = u.email
FROM auth.users u WHERE u.id = p.id AND p.email IS NULL;

-- signup now only creates the profile; workspace creation happens in-app
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

-- atomic workspace creation with owner membership
CREATE OR REPLACE FUNCTION public.create_workspace(_name text, _slug text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  base_slug text;
  final_slug text;
  n int := 0;
  ws_id uuid;
  member_id uuid;
  owner_role uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  base_slug := regexp_replace(lower(coalesce(nullif(trim(_slug), ''), _name)), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  IF base_slug = '' OR base_slug IS NULL THEN base_slug := 'workspace'; END IF;
  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM public.workspaces w WHERE w.slug = final_slug) LOOP
    n := n + 1;
    final_slug := base_slug || '-' || n::text;
  END LOOP;

  INSERT INTO public.workspaces (name, slug, owner_user_id)
  VALUES (trim(_name), final_slug, uid)
  RETURNING id INTO ws_id;

  SELECT id INTO owner_role FROM public.roles WHERE name = 'owner';

  INSERT INTO public.workspace_members (workspace_id, user_id, role, role_id)
  VALUES (ws_id, uid, 'owner', owner_role)
  RETURNING id INTO member_id;

  IF owner_role IS NOT NULL THEN
    INSERT INTO public.member_roles (member_id, role_id) VALUES (member_id, owner_role)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN ws_id;
END; $$;

REVOKE ALL ON FUNCTION public.create_workspace(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workspace(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.member_workspace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_workspace(uuid) TO authenticated;

-- realtime
ALTER TABLE public.workspaces REPLICA IDENTITY FULL;
ALTER TABLE public.workspace_members REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.workspaces;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_members;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;