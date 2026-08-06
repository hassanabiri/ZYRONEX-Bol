
CREATE TYPE public.marketing_campaign_status AS ENUM ('draft','pending_approval','scheduled','active','paused','completed','archived');
CREATE TYPE public.marketing_channel AS ENUM ('social','email','whatsapp','sms','search','display','video','content','events','affiliate');
CREATE TYPE public.creative_kind AS ENUM ('image','video','reel','short_video','copywriting','ad_copy','social_post','banner','landing_page','email_campaign','whatsapp_message','sms_campaign','multi_platform');
CREATE TYPE public.creative_status AS ENUM ('draft','queued','running','review','approved','rejected','failed','archived');
CREATE TYPE public.marketing_alert_kind AS ENUM ('low_credit','credit_exhaustion','high_burn','campaign_stopped','weak_performance','opportunity','optimization','buy_credits','upgrade_plan');
CREATE TYPE public.marketing_alert_severity AS ENUM ('info','warning','critical');
CREATE TYPE public.approval_state AS ENUM ('pending','approved','rejected','cancelled');
CREATE TYPE public.transfer_state AS ENUM ('pending','approved','completed','rejected');

CREATE TABLE public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  objective text,
  channel public.marketing_channel NOT NULL DEFAULT 'social',
  status public.marketing_campaign_status NOT NULL DEFAULT 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  budget_total numeric NOT NULL DEFAULT 0,
  budget_spent numeric NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  coordinator_worker_id uuid REFERENCES public.ai_workers(id) ON DELETE SET NULL,
  owner_user_id uuid,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_campaigns TO authenticated;
GRANT ALL ON public.marketing_campaigns TO service_role;
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage campaigns" ON public.marketing_campaigns FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_marketing_campaigns_updated BEFORE UPDATE ON public.marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.campaign_budget_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  channel public.marketing_channel NOT NULL,
  allocated numeric NOT NULL DEFAULT 0,
  spent numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_budget_allocations TO authenticated;
GRANT ALL ON public.campaign_budget_allocations TO service_role;
ALTER TABLE public.campaign_budget_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage allocations" ON public.campaign_budget_allocations FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_campaign_budget_allocations_updated BEFORE UPDATE ON public.campaign_budget_allocations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.creative_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL,
  kind public.creative_kind NOT NULL,
  title text NOT NULL,
  brief text,
  status public.creative_status NOT NULL DEFAULT 'draft',
  assigned_worker_id uuid REFERENCES public.ai_workers(id) ON DELETE SET NULL,
  execution_id uuid REFERENCES public.executions(id) ON DELETE SET NULL,
  variant_label text,
  parent_request_id uuid REFERENCES public.creative_requests(id) ON DELETE SET NULL,
  output jsonb NOT NULL DEFAULT '{}',
  duration_ms integer,
  credit_cost numeric NOT NULL DEFAULT 0,
  credit_type public.credit_type NOT NULL DEFAULT 'ai_credits',
  performance_score numeric,
  saved_to_library boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creative_requests TO authenticated;
GRANT ALL ON public.creative_requests TO service_role;
ALTER TABLE public.creative_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage creative requests" ON public.creative_requests FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_creative_requests_updated BEFORE UPDATE ON public.creative_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.credit_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  from_type public.credit_type NOT NULL,
  to_type public.credit_type NOT NULL,
  from_amount numeric NOT NULL,
  to_amount numeric NOT NULL,
  rate numeric NOT NULL DEFAULT 1,
  fee numeric NOT NULL DEFAULT 0,
  status public.transfer_state NOT NULL DEFAULT 'completed',
  note text,
  created_by uuid,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_transfers TO authenticated;
GRANT ALL ON public.credit_transfers TO service_role;
ALTER TABLE public.credit_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage credit transfers" ON public.credit_transfers FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TABLE public.marketing_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind public.marketing_alert_kind NOT NULL,
  severity public.marketing_alert_severity NOT NULL DEFAULT 'info',
  title text NOT NULL,
  reason text,
  expected_impact text,
  recommended_action text,
  action_key text,
  action_payload jsonb NOT NULL DEFAULT '{}',
  campaign_id uuid REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_alerts TO authenticated;
GRANT ALL ON public.marketing_alerts TO service_role;
ALTER TABLE public.marketing_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage marketing alerts" ON public.marketing_alerts FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TABLE public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  subject_type text NOT NULL,
  subject_id uuid,
  title text NOT NULL,
  details text,
  amount numeric,
  currency text NOT NULL DEFAULT 'USD',
  levels_required integer NOT NULL DEFAULT 1,
  levels_approved integer NOT NULL DEFAULT 0,
  status public.approval_state NOT NULL DEFAULT 'pending',
  requested_by uuid,
  decided_by uuid,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_requests TO authenticated;
GRANT ALL ON public.approval_requests TO service_role;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage approvals" ON public.approval_requests FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_approval_requests_updated BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.brand_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  brand_name text,
  tone text,
  voice text,
  writing_style text,
  colors jsonb NOT NULL DEFAULT '[]',
  fonts jsonb NOT NULL DEFAULT '[]',
  logo_url text,
  guidelines text,
  keywords text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_profiles TO authenticated;
GRANT ALL ON public.brand_profiles TO service_role;
ALTER TABLE public.brand_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage brand profile" ON public.brand_profiles FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_brand_profiles_updated BEFORE UPDATE ON public.brand_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.marketing_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.marketing_audit_log TO authenticated;
GRANT SELECT, INSERT ON public.marketing_audit_log TO service_role;
ALTER TABLE public.marketing_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read audit log" ON public.marketing_audit_log FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members append audit log" ON public.marketing_audit_log FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE INDEX idx_marketing_campaigns_ws ON public.marketing_campaigns(workspace_id, status);
CREATE INDEX idx_creative_requests_ws ON public.creative_requests(workspace_id, status);
CREATE INDEX idx_marketing_alerts_ws ON public.marketing_alerts(workspace_id, resolved);
CREATE INDEX idx_approval_requests_ws ON public.approval_requests(workspace_id, status);
CREATE INDEX idx_marketing_audit_ws ON public.marketing_audit_log(workspace_id, created_at DESC);
