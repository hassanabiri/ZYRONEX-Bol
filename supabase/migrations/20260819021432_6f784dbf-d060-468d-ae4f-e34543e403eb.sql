ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS secret_ciphertext text,
  ADD COLUMN IF NOT EXISTS connector text,
  ADD COLUMN IF NOT EXISTS workflow_id uuid REFERENCES public.workflows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replay_window_seconds integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS webhook_endpoints_slug_key ON public.webhook_endpoints (slug);

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL,
  execution_id uuid REFERENCES public.executions(id) ON DELETE SET NULL,
  connector text,
  event_id text NOT NULL,
  event_type text NOT NULL DEFAULT 'unknown',
  trace_id uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'received',
  signature_valid boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_events_status_check CHECK (status IN ('received','queued','processing','processed','failed','dead_letter','discarded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_dedupe_idx ON public.webhook_events (endpoint_id, event_id);
CREATE INDEX IF NOT EXISTS webhook_events_retry_idx ON public.webhook_events (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS webhook_events_workspace_idx ON public.webhook_events (workspace_id, received_at DESC);

GRANT SELECT ON public.webhook_events TO authenticated;
GRANT ALL ON public.webhook_events TO service_role;

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members read webhook events" ON public.webhook_events;
CREATE POLICY "Workspace members read webhook events"
  ON public.webhook_events FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS update_webhook_events_updated_at ON public.webhook_events;
CREATE TRIGGER update_webhook_events_updated_at
  BEFORE UPDATE ON public.webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();