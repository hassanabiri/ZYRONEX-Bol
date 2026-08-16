ALTER TABLE public.executions
  ADD COLUMN IF NOT EXISTS trace_id text NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_run_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;

ALTER TABLE public.execution_steps
  ADD COLUMN IF NOT EXISTS trace_id text;

CREATE UNIQUE INDEX IF NOT EXISTS executions_workspace_idempotency_uidx
  ON public.executions (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS executions_dispatch_idx
  ON public.executions (status, next_run_at, priority DESC);

CREATE OR REPLACE FUNCTION public.claim_executions(
  _lease_owner text,
  _lease_seconds integer DEFAULT 120,
  _limit integer DEFAULT 3
)
RETURNS SETOF public.executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT e.id
    FROM public.executions e
    WHERE e.status IN ('queued', 'retrying')
      AND e.next_run_at <= now()
      AND (e.lease_expires_at IS NULL OR e.lease_expires_at < now())
    ORDER BY e.priority DESC, e.queued_at ASC
    LIMIT GREATEST(1, LEAST(_limit, 10))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.executions e
  SET lease_owner = _lease_owner,
      lease_expires_at = now() + make_interval(secs => GREATEST(30, LEAST(_lease_seconds, 900))),
      status = 'running',
      started_at = COALESCE(e.started_at, now()),
      updated_at = now()
  FROM picked
  WHERE e.id = picked.id
  RETURNING e.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_executions(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_executions(text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.reap_stale_executions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.executions e
  SET status = 'queued',
      lease_owner = NULL,
      lease_expires_at = NULL,
      next_run_at = now(),
      updated_at = now()
  WHERE e.status = 'running'
    AND e.lease_expires_at IS NOT NULL
    AND e.lease_expires_at < now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stale_executions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stale_executions() TO service_role;