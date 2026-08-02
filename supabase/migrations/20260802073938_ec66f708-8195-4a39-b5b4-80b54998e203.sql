CREATE TYPE public.voice_provider_kind AS ENUM ('twilio','telnyx','vonage','plivo','sip','pbx','local','custom');
CREATE TYPE public.voice_provider_status AS ENUM ('prepared','pending','connected','disconnected','error','archived');
CREATE TYPE public.voice_number_type AS ENUM ('platform','byon','sip_trunk','pbx');
CREATE TYPE public.voice_number_status AS ENUM ('available','pending','verifying','connected','disconnected','archived');
CREATE TYPE public.call_direction AS ENUM ('inbound','outbound');
CREATE TYPE public.call_status AS ENUM ('queued','ringing','in_progress','completed','failed','missed','cancelled','no_answer');
CREATE TYPE public.credit_type AS ENUM ('ai_credits','voice_minutes','storage','knowledge','integrations','marketplace');
CREATE TYPE public.credit_txn_kind AS ENUM ('grant','purchase','consumption','refund','expiry','adjustment');
CREATE TYPE public.usage_category AS ENUM ('worker','voice','api','knowledge','memory','storage','integration');
CREATE TYPE public.subscription_status AS ENUM ('trialing','active','past_due','paused','cancelled','expired');
CREATE TYPE public.invoice_status AS ENUM ('draft','open','paid','void','uncollectible','archived');
CREATE TYPE public.payment_provider AS ENUM ('stripe','hyperpay','paytabs','moyasar','stc_pay','manual');
CREATE TYPE public.billing_scope AS ENUM ('workspace','organization','owner','developer','reseller');

-- ============ VOICE ============
CREATE TABLE public.voice_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL,
  name text NOT NULL,
  kind public.voice_provider_kind NOT NULL,
  description text,
  status public.voice_provider_status NOT NULL DEFAULT 'prepared',
  enabled boolean NOT NULL DEFAULT false,
  region text NOT NULL DEFAULT 'global',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  capabilities text[] NOT NULL DEFAULT '{}',
  credential_fingerprint text,
  credential_updated_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  tags text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_voice_providers_workspace ON public.voice_providers(workspace_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_providers TO authenticated;
GRANT ALL ON public.voice_providers TO service_role;
ALTER TABLE public.voice_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voice_providers_read" ON public.voice_providers FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "voice_providers_write" ON public.voice_providers FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER trg_voice_providers_updated BEFORE UPDATE ON public.voice_providers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.voice_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES public.voice_providers(id) ON DELETE SET NULL,
  worker_id uuid REFERENCES public.ai_workers(id) ON DELETE SET NULL,
  label text NOT NULL,
  phone_number text NOT NULL,
  number_type public.voice_number_type NOT NULL DEFAULT 'platform',
  country text NOT NULL DEFAULT 'SA',
  status public.voice_number_status NOT NULL DEFAULT 'available',
  capabilities text[] NOT NULL DEFAULT '{voice}',
  verified_at timestamptz,
  connected_at timestamptz,
  monthly_cost numeric(12,2) NOT NULL DEFAULT 0,
  tags text[] NOT NULL DEFAULT '{}',
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, phone_number)
);
CREATE INDEX idx_voice_numbers_workspace ON public.voice_numbers(workspace_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_numbers TO authenticated;
GRANT ALL ON public.voice_numbers TO service_role;
ALTER TABLE public.voice_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voice_numbers_read" ON public.voice_numbers FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "voice_numbers_write" ON public.voice_numbers FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER trg_voice_numbers_updated BEFORE UPDATE ON public.voice_numbers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.voice_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES public.ai_workers(id) ON DELETE CASCADE,
  number_id uuid REFERENCES public.voice_numbers(id) ON DELETE SET NULL,
  name text NOT NULL,
  voice text NOT NULL DEFAULT 'neutral',
  language text NOT NULL DEFAULT 'en',
  accent text NOT NULL DEFAULT 'standard',
  greeting text,
  silence_timeout_seconds integer NOT NULL DEFAULT 8,
  max_call_duration_seconds integer NOT NULL DEFAULT 900,
  transfer_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  recording_policy text NOT NULL DEFAULT 'disabled',
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_voice_profiles_workspace ON public.voice_profiles(workspace_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_profiles TO authenticated;
GRANT ALL ON public.voice_profiles TO service_role;
ALTER TABLE public.voice_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voice_profiles_read" ON public.voice_profiles FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "voice_profiles_write" ON public.voice_profiles FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE TRIGGER trg_voice_profiles_updated BEFORE UPDATE ON public.voice_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.voice_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  number_id uuid REFERENCES public.voice_numbers(id) ON DELETE SET NULL,
  provider_id uuid REFERENCES public.voice_providers(id) ON DELETE SET NULL,
  worker_id uuid REFERENCES public.ai_workers(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES public.voice_profiles(id) ON DELETE SET NULL,
  direction public.call_direction NOT NULL,
  status public.call_status NOT NULL DEFAULT 'queued',
  from_number text NOT NULL,
  to_number text NOT NULL,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer NOT NULL DEFAULT 0,
  recording_path text,
  transcript text,
  result text,
  error text,
  cost numeric(12,4) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_voice_calls_workspace ON public.voice_calls(workspace_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.voice_calls TO authenticated;
GRANT ALL ON public.voice_calls TO service_role;
ALTER TABLE public.voice_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voice_calls_read" ON public.voice_calls FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "voice_calls_insert" ON public.voice_calls FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));
CREATE POLICY "voice_calls_update" ON public.voice_calls FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','member']::workspace_role[]));

-- ============ BILLING ============
CREATE TABLE public.billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scope public.billing_scope NOT NULL DEFAULT 'workspace',
  plan text NOT NULL DEFAULT 'free',
  status public.subscription_status NOT NULL DEFAULT 'trialing',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  currency text NOT NULL DEFAULT 'USD',
  amount numeric(12,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  seats integer NOT NULL DEFAULT 1,
  trial_ends_at timestamptz,
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  payment_provider public.payment_provider NOT NULL DEFAULT 'manual',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, scope)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_subscriptions TO authenticated;
GRANT ALL ON public.billing_subscriptions TO service_role;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing_subscriptions_read" ON public.billing_subscriptions FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "billing_subscriptions_write" ON public.billing_subscriptions FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER trg_billing_subscriptions_updated BEFORE UPDATE ON public.billing_subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.credit_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  credit_type public.credit_type NOT NULL,
  granted numeric(14,2) NOT NULL DEFAULT 0,
  used numeric(14,2) NOT NULL DEFAULT 0,
  reserved numeric(14,2) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'credit',
  resets_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, credit_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_balances TO authenticated;
GRANT ALL ON public.credit_balances TO service_role;
ALTER TABLE public.credit_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credit_balances_read" ON public.credit_balances FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "credit_balances_write" ON public.credit_balances FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER trg_credit_balances_updated BEFORE UPDATE ON public.credit_balances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  credit_type public.credit_type NOT NULL,
  kind public.credit_txn_kind NOT NULL,
  amount numeric(14,2) NOT NULL,
  balance_after numeric(14,2),
  reason text,
  reference_type text,
  reference_id uuid,
  actor_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_credit_txn_workspace ON public.credit_transactions(workspace_id, created_at DESC);
GRANT SELECT, INSERT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credit_transactions_read" ON public.credit_transactions FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "credit_transactions_insert" ON public.credit_transactions FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TABLE public.usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category public.usage_category NOT NULL,
  credit_type public.credit_type NOT NULL DEFAULT 'ai_credits',
  worker_id uuid REFERENCES public.ai_workers(id) ON DELETE SET NULL,
  reference_type text,
  reference_id uuid,
  quantity numeric(14,4) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'unit',
  unit_cost numeric(12,6) NOT NULL DEFAULT 0,
  total_cost numeric(14,4) NOT NULL DEFAULT 0,
  occurred_on date NOT NULL DEFAULT current_date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_records_workspace ON public.usage_records(workspace_id, occurred_on DESC);
GRANT SELECT, INSERT ON public.usage_records TO authenticated;
GRANT ALL ON public.usage_records TO service_role;
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage_records_read" ON public.usage_records FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "usage_records_insert" ON public.usage_records FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.billing_subscriptions(id) ON DELETE SET NULL,
  number text NOT NULL,
  status public.invoice_status NOT NULL DEFAULT 'draft',
  scope public.billing_scope NOT NULL DEFAULT 'workspace',
  currency text NOT NULL DEFAULT 'USD',
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  period_start date,
  period_end date,
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  payment_provider public.payment_provider NOT NULL DEFAULT 'manual',
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, number)
);
CREATE INDEX idx_invoices_workspace ON public.invoices(workspace_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices_read" ON public.invoices FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "invoices_write" ON public.invoices FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  category public.usage_category,
  quantity numeric(14,4) NOT NULL DEFAULT 1,
  unit_price numeric(12,4) NOT NULL DEFAULT 0,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoice_items_invoice ON public.invoice_items(invoice_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_items_read" ON public.invoice_items FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "invoice_items_write" ON public.invoice_items FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));

CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider public.payment_provider NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'prepared',
  is_default boolean NOT NULL DEFAULT false,
  fingerprint text,
  credential_fingerprint text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_methods_read" ON public.payment_methods FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE POLICY "payment_methods_write" ON public.payment_methods FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER trg_payment_methods_updated BEFORE UPDATE ON public.payment_methods FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();