// All trading + connections server functions. Client-safe module — server
// handler bodies are stripped from the browser bundle.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------- read helpers ----------

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [acct, openPos, closedPos, settings, conns] = await Promise.all([
      supabase.from("paper_accounts").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("positions").select("*").eq("user_id", userId).eq("status", "open"),
      supabase.from("positions").select("realized_pnl,closed_at").eq("user_id", userId).eq("status", "closed"),
      supabase.from("automation_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("exchange_connections").select("id,label,connector_id,status,health,trading_enabled").eq("user_id", userId),
    ]);
    const realized = (closedPos.data ?? []).reduce((s, r) => s + Number(r.realized_pnl ?? 0), 0);
    const wins = (closedPos.data ?? []).filter(p => Number(p.realized_pnl) > 0).length;
    const total = (closedPos.data ?? []).length;
    return {
      account: acct.data,
      openPositions: openPos.data ?? [],
      settings: settings.data,
      connections: conns.data ?? [],
      metrics: {
        realizedPnl: realized,
        openCount: openPos.data?.length ?? 0,
        totalClosed: total,
        winRate: total > 0 ? wins / total : 0,
      },
    };
  });

export const listConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("exchange_connections").select("*").eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const listPositions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("positions").select("*")
      .eq("user_id", context.userId).order("opened_at", { ascending: false });
    // Attach live quotes for open positions.
    const { createPaperConnector } = await import("@/lib/connectors/paper.server");
    const paper = createPaperConnector();
    const withPrices = await Promise.all((data ?? []).map(async (p) => {
      if (p.status !== "open") return { ...p, currentPrice: null, unrealized: 0 };
      const q = await paper.getQuote(p.symbol);
      const dir = p.side === "long" ? 1 : -1;
      const unrealized = (q.mid - Number(p.avg_entry)) * dir * Number(p.qty);
      return { ...p, currentPrice: q.mid, unrealized };
    }));
    return withPrices;
  });

export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("orders").select("*")
      .eq("user_id", context.userId).order("created_at", { ascending: false }).limit(200);
    return data ?? [];
  });

export const listSignals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("signals").select("*")
      .eq("user_id", context.userId).order("created_at", { ascending: false }).limit(50);
    return data ?? [];
  });

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("automation_settings").select("*")
      .eq("user_id", context.userId).maybeSingle();
    return data;
  });

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("profiles").select("*")
      .eq("id", context.userId).maybeSingle();
    return data;
  });

// ---------- mutations ----------

const AddConnectionSchema = z.object({
  connectorId: z.string().min(1),
  label: z.string().min(1).max(80),
  credentials: z.record(z.string()).default({}),
  tradingEnabled: z.boolean().default(false),
});

export const addConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AddConnectionSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { encryptJSON } = await import("@/lib/crypto.server");
    const ciphertext = Object.keys(data.credentials).length
      ? encryptJSON(data.credentials)
      : null;
    const { data: row, error } = await context.supabase.from("exchange_connections").insert({
      user_id: context.userId,
      connector_id: data.connectorId,
      label: data.label,
      status: "connected",
      health: "healthy",
      read_enabled: true,
      trading_enabled: data.tradingEnabled && data.connectorId === "paper",
      credential_ciphertext: ciphertext,
      last_sync_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    await context.supabase.from("audit_log").insert({
      user_id: context.userId, action: "connection.add",
      entity: "exchange_connections", entity_id: row.id,
      payload: { connectorId: data.connectorId, label: data.label },
    });
    return row;
  });

export const disconnectConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("exchange_connections")
      .update({ status: "disconnected", trading_enabled: false, credential_ciphertext: null, health: "unknown" })
      .eq("id", data.id).eq("user_id", context.userId);
    if (error) throw error;
    await context.supabase.from("audit_log").insert({
      user_id: context.userId, action: "connection.disconnect",
      entity: "exchange_connections", entity_id: data.id, payload: {},
    });
    return { ok: true };
  });

export const setPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    tradingEnabled: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: conn } = await context.supabase.from("exchange_connections")
      .select("connector_id").eq("id", data.id).eq("user_id", context.userId).maybeSingle();
    if (!conn) throw new Error("Connection not found");
    if (data.tradingEnabled && conn.connector_id !== "paper") {
      throw new Error("Live trading permissions are disabled in this build. Only paper trading is enabled.");
    }
    await context.supabase.from("exchange_connections")
      .update({ trading_enabled: data.tradingEnabled })
      .eq("id", data.id).eq("user_id", context.userId);
    await context.supabase.from("audit_log").insert({
      user_id: context.userId, action: "connection.permission.change",
      entity: "exchange_connections", entity_id: data.id,
      payload: { tradingEnabled: data.tradingEnabled },
    });
    return { ok: true };
  });

const SettingsSchema = z.object({
  mode: z.enum(["manual", "assisted", "autonomous"]).optional(),
  riskLevel: z.enum(["conservative", "balanced", "aggressive"]).optional(),
  maxTradeSize: z.number().positive().optional(),
  maxDailyLoss: z.number().positive().optional(),
  maxTradesPerDay: z.number().int().positive().optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  allowedAssets: z.array(z.string()).optional(),
});

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SettingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Guard autonomous mode behind disclaimer ack
    if (data.mode === "autonomous") {
      const { data: prof } = await context.supabase.from("profiles")
        .select("autonomous_disclaimer_acked_at").eq("id", context.userId).maybeSingle();
      if (!prof?.autonomous_disclaimer_acked_at) {
        throw new Error("You must acknowledge the risk disclaimer before enabling Autonomous mode.");
      }
    }
    const patch: Record<string, unknown> = {};
    if (data.mode) patch.mode = data.mode;
    if (data.riskLevel) patch.risk_level = data.riskLevel;
    if (data.maxTradeSize !== undefined) patch.max_trade_size = data.maxTradeSize;
    if (data.maxDailyLoss !== undefined) patch.max_daily_loss = data.maxDailyLoss;
    if (data.maxTradesPerDay !== undefined) patch.max_trades_per_day = data.maxTradesPerDay;
    if (data.minConfidence !== undefined) patch.min_confidence = data.minConfidence;
    if (data.allowedAssets) patch.allowed_assets = data.allowedAssets;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await context.supabase.from("automation_settings")
      .update(patch as any).eq("user_id", context.userId);
    if (error) throw error;
    await context.supabase.from("audit_log").insert({
      user_id: context.userId, action: "settings.update", entity: "automation_settings",
      entity_id: null, payload: patch as Record<string, string | number | boolean | string[] | null>,
    });
    return { ok: true };
  });

export const acknowledgeDisclaimer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase.from("profiles")
      .update({ autonomous_disclaimer_acked_at: new Date().toISOString() })
      .eq("id", context.userId);
    await context.supabase.from("audit_log").insert({
      user_id: context.userId, action: "disclaimer.ack", entity: "profiles",
      entity_id: context.userId, payload: {},
    });
    return { ok: true };
  });

export const setKillSwitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase.from("automation_settings")
      .update({ kill_switch_active: data.active })
      .eq("user_id", context.userId);
    if (data.active) {
      // Cancel all pending signals
      await context.supabase.from("signals").update({ status: "expired", resolved_at: new Date().toISOString() })
        .eq("user_id", context.userId).eq("status", "pending");
    }
    await context.supabase.from("audit_log").insert({
      user_id: context.userId, action: data.active ? "kill_switch.activate" : "kill_switch.deactivate",
      entity: "automation_settings", entity_id: null, payload: {},
    });
    return { ok: true };
  });

// Generate a fresh AI signal. In Assisted mode → creates pending signal.
// In Autonomous mode → runs risk gate + executes. In Manual → creates pending as info.
export const generateAndRouteSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: settings } = await supabase.from("automation_settings").select("*").eq("user_id", userId).maybeSingle();
    if (!settings) throw new Error("Settings not found");
    if (settings.kill_switch_active) throw new Error("Kill switch is active. Disable it to generate signals.");

    const { generateSignal } = await import("@/lib/trading/signalGenerator.server");
    const sig = await generateSignal(settings.allowed_assets ?? []);

    const { data: inserted, error } = await supabase.from("signals").insert({
      user_id: userId,
      symbol: sig.symbol, side: sig.side,
      entry: sig.entry, stop_loss: sig.stopLoss, take_profit: sig.takeProfit,
      qty: sig.qty, confidence: sig.confidence, reasoning: sig.reasoning,
      risk_reward: sig.riskReward, status: "pending",
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }).select().single();
    if (error) throw error;

    if (settings.mode === "autonomous") {
      await executeSignalInternal(supabase, userId, inserted.id);
    }
    return inserted;
  });

async function executeSignalInternal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, userId: string, signalId: string,
) {
  const { data: sig } = await supabase.from("signals").select("*")
    .eq("id", signalId).eq("user_id", userId).maybeSingle();
  if (!sig) throw new Error("Signal not found");
  if (sig.status !== "pending") throw new Error(`Signal is ${sig.status}`);

  const { evaluateRisk } = await import("@/lib/trading/riskGate.server");
  const decision = await evaluateRisk(supabase, userId, {
    symbol: sig.symbol, side: sig.side, qty: Number(sig.qty),
    entry: Number(sig.entry), stopLoss: Number(sig.stop_loss),
    takeProfit: Number(sig.take_profit), confidence: Number(sig.confidence),
  });
  if (!decision.allowed) {
    await supabase.from("signals").update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", signalId);
    await supabase.from("audit_log").insert({
      user_id: userId, action: "trade.reject", entity: "signals", entity_id: signalId,
      payload: { reason: decision.reason },
    });
    throw new Error(decision.reason ?? "Rejected by risk gate");
  }

  const { data: acct } = await supabase.from("paper_accounts").select("*")
    .eq("user_id", userId).maybeSingle();
  if (!acct) throw new Error("No paper account");

  const { createPaperConnector } = await import("@/lib/connectors/paper.server");
  const conn = createPaperConnector();
  const result = await conn.placeOrder({
    symbol: sig.symbol, side: sig.side, qty: Number(sig.qty), orderType: "market",
  });
  const filledPrice = result.filledPrice ?? Number(sig.entry);
  const notional = filledPrice * Number(sig.qty);

  // Create position
  const { data: pos } = await supabase.from("positions").insert({
    user_id: userId, account_id: acct.id,
    symbol: sig.symbol,
    side: sig.side === "buy" ? "long" : "short",
    qty: sig.qty, avg_entry: filledPrice,
    stop_loss: sig.stop_loss, take_profit: sig.take_profit,
    status: "open",
    ai_reasoning: sig.reasoning, ai_confidence: sig.confidence,
  }).select().single();

  // Create order record
  await supabase.from("orders").insert({
    user_id: userId, account_id: acct.id, position_id: pos?.id,
    symbol: sig.symbol, side: sig.side, qty: sig.qty,
    order_type: "market", status: "filled",
    filled_price: filledPrice, fees: result.fees, slippage_bps: result.slippageBps,
    filled_at: new Date().toISOString(),
  });

  // Deduct cash (paper)
  await supabase.from("paper_accounts").update({
    cash_balance: Number(acct.cash_balance) - notional - result.fees,
  }).eq("id", acct.id);

  await supabase.from("signals").update({ status: "executed", resolved_at: new Date().toISOString() })
    .eq("id", signalId);

  await supabase.from("audit_log").insert({
    user_id: userId, action: "trade.execute", entity: "positions", entity_id: pos?.id,
    payload: { symbol: sig.symbol, qty: sig.qty, filledPrice, fees: result.fees },
  });
}

export const approveSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ signalId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await executeSignalInternal(context.supabase, context.userId, data.signalId);
    return { ok: true };
  });

export const rejectSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ signalId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase.from("signals")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", data.signalId).eq("user_id", context.userId);
    await context.supabase.from("audit_log").insert({
      user_id: context.userId, action: "signal.reject", entity: "signals",
      entity_id: data.signalId, payload: {},
    });
    return { ok: true };
  });

export const closePosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    positionId: z.string().uuid(),
    reason: z.string().default("manual"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: pos } = await supabase.from("positions").select("*")
      .eq("id", data.positionId).eq("user_id", userId).maybeSingle();
    if (!pos || pos.status !== "open") throw new Error("Position not open");
    const { createPaperConnector } = await import("@/lib/connectors/paper.server");
    const conn = createPaperConnector();
    const quote = await conn.getQuote(pos.symbol);
    const exitPrice = pos.side === "long" ? quote.bid : quote.ask;
    const dir = pos.side === "long" ? 1 : -1;
    const pnl = (exitPrice - Number(pos.avg_entry)) * dir * Number(pos.qty);
    const notional = exitPrice * Number(pos.qty);
    const fees = notional * 0.001;
    await supabase.from("positions").update({
      status: "closed", exit_price: exitPrice, exit_reason: data.reason,
      realized_pnl: pnl - fees, closed_at: new Date().toISOString(),
    }).eq("id", pos.id);
    // Return cash + realized PnL
    const { data: acct } = await supabase.from("paper_accounts").select("*")
      .eq("id", pos.account_id).maybeSingle();
    if (acct) {
      await supabase.from("paper_accounts").update({
        cash_balance: Number(acct.cash_balance) + notional - fees,
      }).eq("id", acct.id);
    }
    await supabase.from("orders").insert({
      user_id: userId, account_id: pos.account_id, position_id: pos.id,
      symbol: pos.symbol, side: pos.side === "long" ? "sell" : "buy", qty: pos.qty,
      order_type: "market", status: "filled", filled_price: exitPrice,
      fees, slippage_bps: 5, filled_at: new Date().toISOString(),
    });
    await supabase.from("audit_log").insert({
      user_id: userId, action: "position.close", entity: "positions",
      entity_id: pos.id, payload: { reason: data.reason, exitPrice, pnl },
    });
    return { ok: true };
  });

export const getAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("audit_log").select("*")
      .eq("user_id", context.userId).order("created_at", { ascending: false }).limit(100);
    return data ?? [];
  });
