
# Foundation + Paper Trading — v1

A secure, modular foundation. Everything is paper (simulated) — no real exchange calls. Architecture is designed so real connectors drop in later without refactors.

## Stack decisions
- **Backend**: Lovable Cloud (auth + Postgres + RLS + edge). No passwords stored — Cloud handles auth.
- **Encryption**: API credentials encrypted with AES-256-GCM using a server-only `CREDENTIAL_ENC_KEY` (auto-generated). Only ciphertext in DB.
- **Server logic**: `createServerFn` for all trading actions (place order, approve trade, kill switch). RLS on every table.
- **AI signals**: stubbed generator now (deterministic mock producing signals with confidence + reasoning) so the approval/execution loop is end-to-end real. Real model can plug in later.

## Design system
Dark, precise "trading terminal" aesthetic: near-black background, cyan/green primary, red destructive, monospace for numbers, subtle grid lines. Semantic tokens in `styles.css`. No purple.

## Routes
```
/                              Landing (public) — CTA to sign in
/auth                          Lovable-managed sign in / sign up
/_authenticated/dashboard      Portfolio overview, P&L, key metrics
/_authenticated/accounts       Connected Accounts (add / verify / disconnect / permissions)
/_authenticated/accounts/new   Add exchange wizard (choose connector → OAuth or API key form)
/_authenticated/signals        AI signals feed (Manual mode)
/_authenticated/approvals      Pending trade approvals (Assisted mode)
/_authenticated/positions      Open positions + monitor (entry, current, P&L, SL/TP, reasoning)
/_authenticated/history        Trade history + journal
/_authenticated/automation     Mode + risk settings + emergency kill switch
/_authenticated/analytics      Win rate, drawdown, Sharpe-lite, equity curve
```

## Database (all RLS-gated to `auth.uid()`)
- `profiles` (auto-created on signup)
- `exchange_connections` — user_id, connector_id, label, status, permissions (read/trade), credential_ciphertext, last_sync_at, health
- `paper_accounts` — user_id, connection_id, base_currency, cash_balance, equity
- `positions` — account_id, symbol, side, qty, avg_entry, stop_loss, take_profit, trailing_stop_pct, opened_at, ai_reasoning
- `orders` — account_id, symbol, side, qty, type, status, filled_price, fees, slippage_bps, created_at, filled_at
- `signals` — user_id, symbol, side, entry, sl, tp, confidence, reasoning, expires_at, status(pending/approved/rejected/executed)
- `automation_settings` — user_id, mode (manual/assisted/autonomous), max_trade_size, max_daily_loss, max_trades_per_day, min_confidence, risk_level, allowed_assets[], kill_switch_active
- `audit_log` — user_id, action, entity, payload, ip, ua, created_at (append-only)

## Connector architecture
`src/lib/connectors/` — TypeScript interface `TradingConnector` with methods: `getBalance`, `getMarketData`, `placeOrder`, `cancelOrder`, `getPositions`, `getHistory`, `verifyCredentials`. Registry maps `connector_id → factory(credentials)`. Ship one implementation: `PaperConnector` (simulates fills with fee + slippage against a synthetic price feed). Adding Binance/Coinbase later = new file + registry entry.

## Trading engine (`src/lib/trading/`)
- `signalGenerator.server.ts` — produces mock AI signals (symbol, side, confidence 0–1, reasoning text, SL/TP, R:R)
- `riskGate.server.ts` — pre-trade checks: confidence ≥ min, size ≤ max, daily loss not breached, trades/day ok, SL present, kill switch off, asset allowed. Returns `{allowed, reason}`.
- `executor.server.ts` — server fn `executeTrade`: risk gate → connector.placeOrder → insert position + order + audit_log
- Modes routed in `executor`: manual = never auto-execute; assisted = create pending signal for approval; autonomous = run risk gate then execute
- Emergency kill switch: sets `kill_switch_active=true`, cancels open orders, blocks new executions

## Security
- Credential encryption helper `src/lib/crypto.server.ts` using Node `crypto` AES-256-GCM
- `CREDENTIAL_ENC_KEY` auto-generated via `generate_secret`
- Read-only default: `permissions.trading = false` on every new connection; user must explicitly toggle
- All mutating server fns use `requireSupabaseAuth` + append to `audit_log`
- Risk disclaimer modal blocks entering Autonomous mode until acknowledged (stored on `profiles`)

## Out of scope for this slice (per your answers)
Real exchange APIs, KYC/AML, native mobile app, marketplace/copy trading, SMS/Telegram, backtesting engine, tax export. Architecture leaves clean seams for all of them.

## Build order (this turn)
1. Enable Cloud, generate `CREDENTIAL_ENC_KEY`
2. Migration: all tables + RLS + grants + `has_role`-style helpers where needed
3. Design system in `styles.css`
4. Connector interface + `PaperConnector` + registry
5. Crypto, risk gate, executor, signal generator (server-only)
6. Server fns: connections CRUD, automation settings, kill switch, approve/reject signal, execute trade, dashboards read
7. Routes + UI (auth gate via managed `_authenticated` layout, sign-in affordance in header)
8. Sitemap + robots, real head metadata

Ready to build on approval.
