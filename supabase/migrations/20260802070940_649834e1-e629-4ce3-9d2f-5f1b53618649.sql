
CREATE TYPE public.integration_status AS ENUM ('pending','healthy','warning','disconnected','expired','auth_error','rate_limited','paused','archived');
CREATE TYPE public.integration_auth_type AS ENUM ('oauth2','api_key','basic','bearer','webhook','custom','none');
CREATE TYPE public.sync_mode AS ENUM ('manual','automatic','scheduled','realtime');
CREATE TYPE public.sync_run_status AS ENUM ('queued','running','completed','failed','conflict','cancelled');
CREATE TYPE public.webhook_direction AS ENUM ('incoming','outgoing');
CREATE TYPE public.integration_log_kind AS ENUM ('request','response','error','retry','auth','connection','sync','webhook');
CREATE TYPE public.marketplace_listing_status AS ENUM ('draft','submitted','approved','rejected','published');

CREATE TABLE public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL,
  category text NOT NULL,
  name text NOT NULL,
  description text,
  status public.integration_status NOT NULL DEFAULT 'pending',
  auth_type public.integration_auth_type NOT NULL DEFAULT 'api_key',
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  scopes text[] NOT NULL DEFAULT '{}',
  environment text NOT NULL DEFAULT 'production',
  sync_mode public.sync_mode NOT NULL DEFAULT 'manual',
  sync_interval_minutes integer NOT NULL DEFAULT 60,
  last_sync_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  credential_fingerprint text,
  credential_updated_at timestamptz,
  expires_at timestamptz,
  request_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  avg_latency_ms integer NOT NULL DEFAULT 0,
  tags text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_integrations_workspace ON public.integrations(workspace_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrations TO authenticated;
GRANT ALL ON public.integrations TO service_role;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "integrations_read" ON public.integrations FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "integrations_write" ON public.integrations FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER trg_integrations_updated BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Encrypted credential vault: server-role only, never reachable from the browser.
CREATE TABLE public.integration_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  fingerprint text NOT NULL,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id)
);
GRANT ALL ON public.integration_credentials TO service_role;
ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.integration_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.integrations(id) ON DELETE CASCADE,
  kind public.integration_log_kind NOT NULL,
  method text,
  endpoint text,
  status_code integer,
  latency_ms integer,
  attempt integer NOT NULL DEFAULT 1,
  message text,
  payload jsonb,
  actor_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_integration_logs_workspace ON public.integration_logs(workspace_id, created_at DESC);
GRANT SELECT, INSERT ON public.integration_logs TO authenticated;
GRANT ALL ON public.integration_logs TO service_role;
ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "integration_logs_read" ON public.integration_logs FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "integration_logs_insert" ON public.integration_logs FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TABLE public.integration_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  mode public.sync_mode NOT NULL DEFAULT 'manual',
  status public.sync_run_status NOT NULL DEFAULT 'queued',
  attempt integer NOT NULL DEFAULT 1,
  max_attempts integer NOT NULL DEFAULT 3,
  conflict_strategy text NOT NULL DEFAULT 'source_wins',
  records_processed integer NOT NULL DEFAULT 0,
  conflicts integer NOT NULL DEFAULT 0,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  error text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_runs_workspace ON public.integration_sync_runs(workspace_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.integration_sync_runs TO authenticated;
GRANT ALL ON public.integration_sync_runs TO service_role;
ALTER TABLE public.integration_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync_runs_read" ON public.integration_sync_runs FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "sync_runs_write" ON public.integration_sync_runs FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));

CREATE TABLE public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL,
  name text NOT NULL,
  direction public.webhook_direction NOT NULL DEFAULT 'incoming',
  url text,
  slug text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  signing_secret_hint text,
  retry_limit integer NOT NULL DEFAULT 3,
  timeout_seconds integer NOT NULL DEFAULT 30,
  last_delivery_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_endpoints TO authenticated;
GRANT ALL ON public.webhook_endpoints TO service_role;
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "webhooks_read" ON public.webhook_endpoints FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "webhooks_write" ON public.webhook_endpoints FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER trg_webhooks_updated BEFORE UPDATE ON public.webhook_endpoints FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event text NOT NULL,
  direction public.webhook_direction NOT NULL,
  status_code integer,
  success boolean NOT NULL DEFAULT false,
  attempt integer NOT NULL DEFAULT 1,
  latency_ms integer,
  signature_valid boolean,
  error text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_deliveries_workspace ON public.webhook_deliveries(workspace_id, created_at DESC);
GRANT SELECT, INSERT ON public.webhook_deliveries TO authenticated;
GRANT ALL ON public.webhook_deliveries TO service_role;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deliveries_read" ON public.webhook_deliveries FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "deliveries_insert" ON public.webhook_deliveries FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  environment text NOT NULL DEFAULT 'production',
  expires_at timestamptz,
  last_used_at timestamptz,
  usage_count integer NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  rotated_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_keys_workspace ON public.api_keys(workspace_id);
GRANT SELECT, UPDATE, DELETE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_keys_read" ON public.api_keys FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "api_keys_manage" ON public.api_keys FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE POLICY "api_keys_delete" ON public.api_keys FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER trg_api_keys_updated BEFORE UPDATE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  publisher text NOT NULL,
  category text NOT NULL,
  description text,
  version text NOT NULL DEFAULT '0.1.0',
  status public.marketplace_listing_status NOT NULL DEFAULT 'draft',
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  install_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_listings TO authenticated;
GRANT ALL ON public.marketplace_listings TO service_role;
ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "listings_read" ON public.marketplace_listings FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "listings_write" ON public.marketplace_listings FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER trg_listings_updated BEFORE UPDATE ON public.marketplace_listings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
