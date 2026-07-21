// Shared close-position path. Used by manual close, stop/TP auto-close, and
// profit protection. Writes a trade_journal entry on every close.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPaperConnector } from "@/lib/connectors/paper.server";

export async function closePositionInternal(
  supabase: SupabaseClient, userId: string, positionId: string, reason: string,
) {
  const { data: pos } = await supabase.from("positions").select("*")
    .eq("id", positionId).eq("user_id", userId).maybeSingle();
  if (!pos || pos.status !== "open") throw new Error("Position not open");

  const paper = createPaperConnector();
  const quote = await paper.getQuote(pos.symbol);
  const exitPrice = pos.side === "long" ? quote.bid : quote.ask;
  const dir = pos.side === "long" ? 1 : -1;
  const grossPnl = (exitPrice - Number(pos.avg_entry)) * dir * Number(pos.qty);
  const notional = exitPrice * Number(pos.qty);
  const fees = +(notional * 0.001).toFixed(4);
  const realized = +(grossPnl - fees).toFixed(4);
  const durationSec = Math.floor((Date.now() - new Date(pos.opened_at).getTime()) / 1000);

  await supabase.from("positions").update({
    status: "closed", exit_price: exitPrice, exit_reason: reason,
    realized_pnl: realized, closed_at: new Date().toISOString(),
    duration_seconds: durationSec,
  }).eq("id", pos.id);

  // Return cash
  const { data: acct } = await supabase.from("paper_accounts").select("*")
    .eq("id", pos.account_id).maybeSingle();
  if (acct) {
    await supabase.from("paper_accounts").update({
      cash_balance: Number(acct.cash_balance) + notional - fees,
      realized_pnl: Number(acct.realized_pnl ?? 0) + realized,
    }).eq("id", acct.id);
  }

  // Order record
  const { data: orderRow } = await supabase.from("orders").insert({
    user_id: userId, account_id: pos.account_id, position_id: pos.id,
    symbol: pos.symbol, side: pos.side === "long" ? "sell" : "buy", qty: pos.qty,
    order_type: "market", status: "filled", filled_price: exitPrice,
    fees, slippage_bps: 5, filled_at: new Date().toISOString(),
  }).select().single();

  await supabase.from("execution_log").insert({
    user_id: userId, position_id: pos.id, order_id: orderRow?.id,
    event: "position.close", severity: reason === "stop_loss" ? "warn" : "info",
    message: `Closed (${reason}) at ${exitPrice} — P&L ${realized.toFixed(2)}`,
    payload: { reason, exitPrice, realized, fees, durationSec },
  });

  // Trade journal entry — count user modifications from execution_log
  const { count: modsCount } = await supabase.from("execution_log")
    .select("*", { count: "exact", head: true })
    .eq("position_id", pos.id)
    .in("event", ["position.stop_moved", "position.reduced", "position.added"]);

  const executionQuality = computeExecutionQuality(realized, pos.side, exitPrice, Number(pos.avg_entry), fees);

  // Attribution: entry order latency + originating signal for indicator contributions.
  const { data: entryOrder } = await supabase.from("orders")
    .select("submitted_at,filled_at,slippage_bps")
    .eq("position_id", pos.id).eq("side", pos.side === "long" ? "buy" : "sell")
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  const execLatencyMs = entryOrder?.submitted_at && entryOrder?.filled_at
    ? new Date(entryOrder.filled_at).getTime() - new Date(entryOrder.submitted_at).getTime()
    : null;

  const { data: originatingSig } = await supabase.from("signals")
    .select("id,contributions,indicators")
    .eq("user_id", userId).eq("symbol", pos.symbol)
    .lte("created_at", pos.opened_at)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const contribs = (originatingSig?.contributions as Array<{ name: string; weight: number }> | null) ?? [];
  const winning = realized >= 0;
  const topContribs = contribs.slice(0, 3).map(c => c.name);
  const attribution = {
    winning_indicators: winning ? topContribs : [],
    losing_indicators: !winning ? topContribs : [],
    execution_helped: Number(entryOrder?.slippage_bps ?? 0) < 5,
    market_regime_at_entry: pos.ai_regime,
    ai_prediction_correct: reason === "take_profit" ? true : reason === "stop_loss" ? false : null,
  };
  const predictedOutcome = pos.ai_confidence && Number(pos.ai_confidence) >= 0.6 ? "win" : "uncertain";
  const actualOutcome = winning ? "win" : "loss";

  await supabase.from("trade_journal").insert({
    user_id: userId, position_id: pos.id,
    signal_id: originatingSig?.id ?? null,
    symbol: pos.symbol, side: pos.side,
    entry_reason: pos.ai_reasoning,
    exit_reason: reason,
    ai_confidence: pos.ai_confidence,
    market_regime: pos.ai_regime,
    entry_price: pos.avg_entry, exit_price: exitPrice,
    qty: pos.qty, realized_pnl: realized, fees_total: fees,
    slippage_bps_avg: Number(entryOrder?.slippage_bps ?? 5),
    execution_quality_score: executionQuality,
    execution_latency_ms: execLatencyMs,
    user_modifications: modsCount ?? 0,
    duration_seconds: durationSec,
    lessons: buildLessons(reason, realized, pos),
    strategy_id: pos.strategy_id,
    model_version: "v0.1-explainable",
    indicators: originatingSig?.indicators ?? {},
    attribution,
    predicted_outcome: predictedOutcome,
    actual_outcome: actualOutcome,
  });

  // Snapshot capital after each close so the growth curve stays fresh.
  try {
    const { snapshotCapitalInternal } = await import("@/lib/liveIntel.functions");
    await snapshotCapitalInternal(supabase, userId);
  } catch { /* non-fatal */ }

  return { ok: true, realized, exitPrice };
}

function computeExecutionQuality(
  realized: number, side: string, exitPrice: number, entry: number, fees: number,
): number {
  // 0-10 score: rewards clean fills relative to feepct + move
  const move = Math.abs(exitPrice - entry) / entry;
  const feePct = Math.abs(fees / (exitPrice * (realized >= 0 ? 1 : 1)));
  const base = 8;
  const feeDrag = Math.min(3, feePct * 1000);
  const win = realized >= 0 ? 1 : -1;
  const score = Math.max(0, Math.min(10, base + win * Math.min(2, move * 50) - feeDrag));
  return +score.toFixed(2);
}

function buildLessons(
  reason: string, realized: number,
  pos: { ai_confidence?: number | null; ai_regime?: string | null; break_even_moved?: boolean },
): string {
  const parts: string[] = [];
  if (reason === "stop_loss") {
    parts.push(realized < 0
      ? "Stop-loss protected capital — thesis invalidated."
      : "Stop hit after break-even move — trailing worked.");
  } else if (reason === "take_profit") {
    parts.push("Target reached — model prediction validated by price action.");
  } else if (reason === "manual") {
    parts.push("Manual exit — review whether AI thesis was still valid.");
  }
  if (pos.ai_confidence && Number(pos.ai_confidence) < 0.7 && realized > 0) {
    parts.push("Won on a low-confidence signal — check calibration.");
  }
  if (pos.ai_regime === "extreme_risk") {
    parts.push("Traded in extreme-risk regime — consider reducing size next time.");
  }
  if (pos.break_even_moved) parts.push("Break-even stop moved (profit protection engaged).");
  return parts.join(" ");
}
