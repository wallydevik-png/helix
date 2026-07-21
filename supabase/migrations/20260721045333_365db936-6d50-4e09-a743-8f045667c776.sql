
-- Live trading intelligence: capital snapshots + attribution columns.
ALTER TABLE public.trade_journal
  ADD COLUMN IF NOT EXISTS execution_latency_ms integer,
  ADD COLUMN IF NOT EXISTS attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS predicted_outcome text,
  ADD COLUMN IF NOT EXISTS actual_outcome text;

CREATE TABLE IF NOT EXISTS public.capital_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  cash_balance numeric(20,8) NOT NULL DEFAULT 0,
  unrealized_pnl numeric(20,8) NOT NULL DEFAULT 0,
  realized_pnl_total numeric(20,8) NOT NULL DEFAULT 0,
  equity numeric(20,8) NOT NULL DEFAULT 0,
  open_positions integer NOT NULL DEFAULT 0,
  gross_exposure numeric(20,8) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, snapshot_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.capital_snapshots TO authenticated;
GRANT ALL ON public.capital_snapshots TO service_role;
ALTER TABLE public.capital_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "capital_snapshots_owner_all" ON public.capital_snapshots
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS capital_snapshots_user_date_idx
  ON public.capital_snapshots (user_id, snapshot_date DESC);
