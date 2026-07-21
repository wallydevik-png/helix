-- Production Execution Engine: API request audit log + reconciliation fields

CREATE TABLE public.api_request_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.exchange_connections(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  venue text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  status_code integer,
  latency_ms integer,
  request_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_snippet text,
  error text,
  is_signed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.api_request_log TO authenticated;
GRANT ALL ON public.api_request_log TO service_role;

ALTER TABLE public.api_request_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_log_owner_read" ON public.api_request_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "api_log_owner_insert" ON public.api_request_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX api_request_log_user_created_idx
  ON public.api_request_log (user_id, created_at DESC);
CREATE INDEX api_request_log_conn_created_idx
  ON public.api_request_log (connection_id, created_at DESC);

-- Reconciliation + clock-skew bookkeeping
ALTER TABLE public.exchange_connections
  ADD COLUMN IF NOT EXISTS last_reconcile_at timestamptz,
  ADD COLUMN IF NOT EXISTS clock_skew_ms integer;

-- Track order execution latency
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_order_id text;

CREATE INDEX IF NOT EXISTS orders_client_order_id_idx
  ON public.orders (client_order_id) WHERE client_order_id IS NOT NULL;