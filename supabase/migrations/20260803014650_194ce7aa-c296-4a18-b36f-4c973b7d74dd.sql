-- Developer Platform ---------------------------------------------------
CREATE TYPE public.developer_project_status AS ENUM ('draft','active','suspended','archived');
CREATE TYPE public.plugin_status AS ENUM ('installed','enabled','disabled','update_available','removed');
CREATE TYPE public.marketplace_category AS ENUM ('workers','workflows','knowledge_packs','prompt_packs','voice_packs','templates','plugins','extensions','automation_packs');
CREATE TYPE public.marketplace_license AS ENUM ('free','paid','subscription','enterprise','trial','lifetime');

CREATE TABLE public.developer_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  environment text NOT NULL DEFAULT 'production',
  status public.developer_project_status NOT NULL DEFAULT 'draft',
  api_version text NOT NULL DEFAULT 'v1',
  rate_limit_per_min integer NOT NULL DEFAULT 600,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.developer_projects TO authenticated;
GRANT ALL ON public.developer_projects TO service_role;
ALTER TABLE public.developer_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read developer projects" ON public.developer_projects FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members write developer projects" ON public.developer_projects FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER developer_projects_updated BEFORE UPDATE ON public.developer_projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.developer_projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  client_id text NOT NULL UNIQUE,
  secret_hash text,
  secret_preview text,
  redirect_uris text[] NOT NULL DEFAULT '{}',
  scopes text[] NOT NULL DEFAULT '{}',
  grant_types text[] NOT NULL DEFAULT ARRAY['authorization_code'],
  status text NOT NULL DEFAULT 'active',
  last_rotated_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oauth_clients TO authenticated;
GRANT ALL ON public.oauth_clients TO service_role;
ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read oauth clients" ON public.oauth_clients FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "admins write oauth clients" ON public.oauth_clients FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER oauth_clients_updated BEFORE UPDATE ON public.oauth_clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.environment_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.developer_projects(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text,
  is_secret boolean NOT NULL DEFAULT false,
  environment text NOT NULL DEFAULT 'production',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, environment, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.environment_variables TO authenticated;
GRANT ALL ON public.environment_variables TO service_role;
ALTER TABLE public.environment_variables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read env vars" ON public.environment_variables FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE POLICY "admins write env vars" ON public.environment_variables FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER environment_variables_updated BEFORE UPDATE ON public.environment_variables FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.plugins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  publisher text NOT NULL DEFAULT 'internal',
  description text,
  version text NOT NULL DEFAULT '1.0.0',
  latest_version text NOT NULL DEFAULT '1.0.0',
  status public.plugin_status NOT NULL DEFAULT 'installed',
  permissions text[] NOT NULL DEFAULT '{}',
  dependencies text[] NOT NULL DEFAULT '{}',
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  installed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plugins TO authenticated;
GRANT ALL ON public.plugins TO service_role;
ALTER TABLE public.plugins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read plugins" ON public.plugins FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members write plugins" ON public.plugins FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER plugins_updated BEFORE UPDATE ON public.plugins FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Marketplace ------------------------------------------------------------
CREATE TABLE public.marketplace_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  category public.marketplace_category NOT NULL,
  summary text,
  description text,
  developer text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',
  license public.marketplace_license NOT NULL DEFAULT 'free',
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  status public.marketplace_listing_status NOT NULL DEFAULT 'draft',
  featured boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  compatibility text,
  release_notes text,
  screenshots jsonb NOT NULL DEFAULT '[]'::jsonb,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  install_count integer NOT NULL DEFAULT 0,
  rating_avg numeric NOT NULL DEFAULT 0,
  rating_count integer NOT NULL DEFAULT 0,
  revenue_cents integer NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_products TO authenticated;
GRANT ALL ON public.marketplace_products TO service_role;
ALTER TABLE public.marketplace_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read published or own products" ON public.marketplace_products FOR SELECT TO authenticated USING (status = 'published' OR public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "publishers write products" ON public.marketplace_products FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER marketplace_products_updated BEFORE UPDATE ON public.marketplace_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.marketplace_product_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version text NOT NULL,
  release_notes text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_product_versions TO authenticated;
GRANT ALL ON public.marketplace_product_versions TO service_role;
ALTER TABLE public.marketplace_product_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read product versions" ON public.marketplace_product_versions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.marketplace_products p WHERE p.id = product_id AND (p.status = 'published' OR public.is_workspace_member(p.workspace_id, auth.uid()))));
CREATE POLICY "publishers write product versions" ON public.marketplace_product_versions FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));

CREATE TABLE public.marketplace_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  reported boolean NOT NULL DEFAULT false,
  verified_purchase boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_reviews TO authenticated;
GRANT ALL ON public.marketplace_reviews TO service_role;
ALTER TABLE public.marketplace_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read reviews of visible products" ON public.marketplace_reviews FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.marketplace_products p WHERE p.id = product_id AND (p.status = 'published' OR public.is_workspace_member(p.workspace_id, auth.uid()))));
CREATE POLICY "authors write own reviews" ON public.marketplace_reviews FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER marketplace_reviews_updated BEFORE UPDATE ON public.marketplace_reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.marketplace_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version text NOT NULL DEFAULT '1.0.0',
  status text NOT NULL DEFAULT 'installed',
  license public.marketplace_license NOT NULL DEFAULT 'free',
  installed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, workspace_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_installs TO authenticated;
GRANT ALL ON public.marketplace_installs TO service_role;
ALTER TABLE public.marketplace_installs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read installs" ON public.marketplace_installs FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.marketplace_products p WHERE p.id = product_id AND public.is_workspace_member(p.workspace_id, auth.uid())));
CREATE POLICY "members write installs" ON public.marketplace_installs FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));

CREATE INDEX idx_marketplace_products_status ON public.marketplace_products (status, category);
CREATE INDEX idx_marketplace_reviews_product ON public.marketplace_reviews (product_id);
CREATE INDEX idx_developer_projects_workspace ON public.developer_projects (workspace_id);
CREATE INDEX idx_plugins_workspace ON public.plugins (workspace_id);

-- Keep product rating aggregates in sync with reviews
CREATE OR REPLACE FUNCTION public.sync_product_rating()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid := COALESCE(NEW.product_id, OLD.product_id);
BEGIN
  UPDATE public.marketplace_products p
  SET rating_avg = COALESCE((SELECT ROUND(AVG(r.rating)::numeric, 2) FROM public.marketplace_reviews r WHERE r.product_id = pid), 0),
      rating_count = (SELECT COUNT(*) FROM public.marketplace_reviews r WHERE r.product_id = pid)
  WHERE p.id = pid;
  RETURN NULL;
END; $$;
CREATE TRIGGER marketplace_reviews_rating AFTER INSERT OR UPDATE OR DELETE ON public.marketplace_reviews FOR EACH ROW EXECUTE FUNCTION public.sync_product_rating();