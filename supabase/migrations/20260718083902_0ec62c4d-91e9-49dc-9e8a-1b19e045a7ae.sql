
-- Extend strategies with multi-strategy + health fields
ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS strategy_type text NOT NULL DEFAULT 'trend_following',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS capital_allocation_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'unmonitored',
  ADD COLUMN IF NOT EXISTS health_notes text,
  ADD COLUMN IF NOT EXISTS last_evaluated_at timestamptz;

-- Shadow-mode trades: what the AI *would* have done, tracked without executing.
CREATE TABLE IF NOT EXISTS public.shadow_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id uuid REFERENCES public.strategies(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  side text NOT NULL,
  entry_ts timestamptz NOT NULL DEFAULT now(),
  entry_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  qty numeric NOT NULL,
  confidence numeric NOT NULL,
  market_regime text,
  status text NOT NULL DEFAULT 'open',
  close_ts timestamptz,
  close_price numeric,
  pnl numeric,
  pnl_pct numeric,
  exit_reason text,
  indicators jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shadow_trades TO authenticated;
GRANT ALL ON public.shadow_trades TO service_role;
ALTER TABLE public.shadow_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shadow trades" ON public.shadow_trades
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_shadow_trades_updated BEFORE UPDATE ON public.shadow_trades
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Optimization runs: grid-search over parameter combinations against backtest engine.
CREATE TABLE IF NOT EXISTS public.optimization_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id uuid REFERENCES public.strategies(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  interval text NOT NULL,
  bars integer NOT NULL,
  param_grid jsonb NOT NULL,
  results jsonb NOT NULL,
  best_params jsonb NOT NULL,
  best_metrics jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.optimization_runs TO authenticated;
GRANT ALL ON public.optimization_runs TO service_role;
ALTER TABLE public.optimization_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own optimization runs" ON public.optimization_runs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_optimization_runs_updated BEFORE UPDATE ON public.optimization_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
