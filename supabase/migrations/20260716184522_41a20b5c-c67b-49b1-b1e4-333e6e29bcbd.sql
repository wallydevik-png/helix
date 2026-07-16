
-- =========================================================
-- PROFILES
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  autonomous_disclaimer_acked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_owner_all" ON public.profiles FOR ALL
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- =========================================================
-- EXCHANGE CONNECTIONS (credentials encrypted at rest)
-- =========================================================
CREATE TABLE public.exchange_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','error','disconnected')),
  read_enabled BOOLEAN NOT NULL DEFAULT true,
  trading_enabled BOOLEAN NOT NULL DEFAULT false,
  credential_ciphertext TEXT,
  health TEXT NOT NULL DEFAULT 'unknown' CHECK (health IN ('unknown','healthy','degraded','down')),
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX exchange_connections_user_idx ON public.exchange_connections(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exchange_connections TO authenticated;
GRANT ALL ON public.exchange_connections TO service_role;
ALTER TABLE public.exchange_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conn_owner_all" ON public.exchange_connections FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- PAPER ACCOUNTS
-- =========================================================
CREATE TABLE public.paper_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES public.exchange_connections(id) ON DELETE SET NULL,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  cash_balance NUMERIC(20,8) NOT NULL DEFAULT 100000,
  equity NUMERIC(20,8) NOT NULL DEFAULT 100000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX paper_accounts_user_idx ON public.paper_accounts(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_accounts TO authenticated;
GRANT ALL ON public.paper_accounts TO service_role;
ALTER TABLE public.paper_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "paper_owner_all" ON public.paper_accounts FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- POSITIONS
-- =========================================================
CREATE TABLE public.positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.paper_accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long','short')),
  qty NUMERIC(20,8) NOT NULL,
  avg_entry NUMERIC(20,8) NOT NULL,
  stop_loss NUMERIC(20,8),
  take_profit NUMERIC(20,8),
  trailing_stop_pct NUMERIC(6,4),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  exit_price NUMERIC(20,8),
  exit_reason TEXT,
  realized_pnl NUMERIC(20,8),
  ai_reasoning TEXT,
  ai_confidence NUMERIC(4,3),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX positions_user_idx ON public.positions(user_id);
CREATE INDEX positions_account_status_idx ON public.positions(account_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.positions TO authenticated;
GRANT ALL ON public.positions TO service_role;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "positions_owner_all" ON public.positions FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- ORDERS
-- =========================================================
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.paper_accounts(id) ON DELETE CASCADE,
  position_id UUID REFERENCES public.positions(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  qty NUMERIC(20,8) NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'market' CHECK (order_type IN ('market','limit')),
  limit_price NUMERIC(20,8),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','filled','cancelled','rejected')),
  filled_price NUMERIC(20,8),
  fees NUMERIC(20,8) DEFAULT 0,
  slippage_bps NUMERIC(10,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  filled_at TIMESTAMPTZ
);
CREATE INDEX orders_user_idx ON public.orders(user_id);
CREATE INDEX orders_account_created_idx ON public.orders(account_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_owner_all" ON public.orders FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- AI SIGNALS
-- =========================================================
CREATE TABLE public.signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  entry NUMERIC(20,8) NOT NULL,
  stop_loss NUMERIC(20,8) NOT NULL,
  take_profit NUMERIC(20,8) NOT NULL,
  qty NUMERIC(20,8) NOT NULL,
  confidence NUMERIC(4,3) NOT NULL,
  reasoning TEXT NOT NULL,
  risk_reward NUMERIC(8,3),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','executed','expired')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX signals_user_status_idx ON public.signals(user_id, status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signals TO authenticated;
GRANT ALL ON public.signals TO service_role;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signals_owner_all" ON public.signals FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- AUTOMATION SETTINGS
-- =========================================================
CREATE TABLE public.automation_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','assisted','autonomous')),
  risk_level TEXT NOT NULL DEFAULT 'balanced' CHECK (risk_level IN ('conservative','balanced','aggressive')),
  max_trade_size NUMERIC(20,8) NOT NULL DEFAULT 1000,
  max_daily_loss NUMERIC(20,8) NOT NULL DEFAULT 500,
  max_trades_per_day INT NOT NULL DEFAULT 10,
  min_confidence NUMERIC(4,3) NOT NULL DEFAULT 0.7,
  allowed_assets TEXT[] NOT NULL DEFAULT ARRAY['BTC-USD','ETH-USD','SOL-USD'],
  kill_switch_active BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.automation_settings TO authenticated;
GRANT ALL ON public.automation_settings TO service_role;
ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "automation_owner_all" ON public.automation_settings FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- AUDIT LOG (append-only)
-- =========================================================
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_user_created_idx ON public.audit_log(user_id, created_at DESC);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_owner_select" ON public.audit_log FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "audit_owner_insert" ON public.audit_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- TRIGGERS
-- =========================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_conn_updated BEFORE UPDATE ON public.exchange_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_paper_updated BEFORE UPDATE ON public.paper_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_auto_updated BEFORE UPDATE ON public.automation_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-create profile, paper account, and automation settings on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  INSERT INTO public.paper_accounts (user_id) VALUES (NEW.id);
  INSERT INTO public.automation_settings (user_id) VALUES (NEW.id);
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
