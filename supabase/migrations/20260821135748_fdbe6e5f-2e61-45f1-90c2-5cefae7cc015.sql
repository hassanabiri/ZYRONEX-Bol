CREATE TYPE public.connection_account_status AS ENUM ('connected','expired','reauth_required','revoked','error','disconnected');

CREATE TABLE public.connection_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL,
  provider text NOT NULL,
  connector text NOT NULL,
  account_identifier text NOT NULL,
  account_label text,
  status public.connection_account_status NOT NULL DEFAULT 'connected',
  credential_ref text,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  refresh_lock_owner text,
  refresh_lock_expires_at timestamptz,
  refresh_failures integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider, account_identifier)
);

GRANT SELECT ON public.connection_accounts TO authenticated;
GRANT ALL ON public.connection_accounts TO service_role;
ALTER TABLE public.connection_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members can view connection accounts"
ON public.connection_accounts FOR SELECT TO authenticated
USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE INDEX connection_accounts_workspace_idx ON public.connection_accounts (workspace_id, provider);
CREATE INDEX connection_accounts_integration_idx ON public.connection_accounts (integration_id);

CREATE TRIGGER update_connection_accounts_updated_at
BEFORE UPDATE ON public.connection_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.oauth_authorization_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.integrations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  connector text NOT NULL,
  redirect_uri text NOT NULL,
  code_verifier text,
  scopes text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.oauth_authorization_states TO service_role;
ALTER TABLE public.oauth_authorization_states ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.connection_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.connection_accounts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  fingerprint text,
  rotated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.connection_credentials TO service_role;
ALTER TABLE public.connection_credentials ENABLE ROW LEVEL SECURITY;