// Market Intelligence server functions.
// Refresh reads through providers (deterministic per 30-min bucket), caches
// into public.market_intel, and returns computed consensus.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { collectSignals } from "./intel/providers.server";
import { computeConsensus, type Consensus } from "./intel/consensus.server";
import { listSupportedSymbols } from "./marketdata/service.server";

const SymbolIn = z.object({ symbol: z.string().min(1).max(32) });

async function refreshOne(supabase: any, symbol: string) {
  const signals = await collectSignals(symbol);
  const rows = signals.map(s => ({
    symbol, provider: s.provider, kind: s.kind,
    score: s.score, confidence: s.confidence,
    payload: s.payload ?? {},
    ts: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  }));
  if (rows.length) {
    await supabase.from("market_intel").upsert(rows, { onConflict: "symbol,provider,kind,ts" });
  }
  return { signals, consensus: computeConsensus(signals) };
}

export const getMarketIntel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SymbolIn.parse(d))
  .handler(async ({ data, context }) => {
    // Try cache first (30-min freshness)
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data: cached } = await context.supabase
      .from("market_intel")
      .select("*")
      .eq("symbol", data.symbol)
      .gte("ts", cutoff)
      .order("ts", { ascending: false });
    let signals = (cached ?? []).map((r: any) => ({
      provider: r.provider, kind: r.kind,
      score: Number(r.score), confidence: Number(r.confidence),
      payload: r.payload ?? {},
    }));
    // Deduplicate to latest per provider+kind
    const seen = new Set<string>();
    signals = signals.filter(s => {
      const k = `${s.provider}:${s.kind}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    if (signals.length === 0) {
      const fresh = await refreshOne(context.supabase, data.symbol);
      return { symbol: data.symbol, signals: fresh.signals, consensus: fresh.consensus, cached: false };
    }
    return { symbol: data.symbol, signals, consensus: computeConsensus(signals), cached: true };
  });

export const refreshMarketIntel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SymbolIn.parse(d))
  .handler(async ({ data, context }) => {
    const { signals, consensus } = await refreshOne(context.supabase, data.symbol);
    return { symbol: data.symbol, signals, consensus, cached: false };
  });

export const getIntelOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const symbols = listSupportedSymbols();
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data: rows } = await context.supabase
      .from("market_intel").select("symbol,provider,kind,score,confidence,ts")
      .in("symbol", symbols).gte("ts", cutoff);
    const grouped: Record<string, any[]> = {};
    for (const r of rows ?? []) {
      const k = `${r.symbol}:${r.provider}:${r.kind}`;
      if (!grouped[r.symbol]) grouped[r.symbol] = [];
      grouped[r.symbol].push({ ...r, score: Number(r.score), confidence: Number(r.confidence) });
    }
    // Refresh symbols with no cached data (best effort, parallel)
    const missing = symbols.filter(s => !grouped[s]);
    await Promise.all(missing.map(async s => {
      const fresh = await refreshOne(context.supabase, s);
      grouped[s] = fresh.signals.map(x => ({ symbol: s, ...x }));
    }));
    const overview: Array<{ symbol: string; consensus: Consensus }> = symbols.map(sym => {
      // dedupe latest per provider+kind
      const seen = new Set<string>();
      const sigs = (grouped[sym] ?? [])
        .sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""))
        .filter(s => { const k = `${s.provider}:${s.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
      return { symbol: sym, consensus: computeConsensus(sigs) };
    });
    overview.sort((a, b) => Math.abs(b.consensus.score) - Math.abs(a.consensus.score));
    return { overview };
  });
