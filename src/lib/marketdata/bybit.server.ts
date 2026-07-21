// Real market data from Bybit v5 public endpoints (no auth required).
// Covers crypto symbols; stocks fall through to synthetic.
import type { Candle, Interval, MarketDataProvider } from "./types";

const BASE = "https://api.bybit.com";

// TanStack/Vite: "-USD" -> Bybit USDT pairs
function toBybit(symbol: string): string | null {
  if (!/-USD$/.test(symbol)) return null;
  const b = symbol.replace("-USD", "");
  return `${b}USDT`;
}

const INTERVAL_MAP: Record<Interval, string> = {
  "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D",
};

export function createBybitMarketDataProvider(): MarketDataProvider {
  return {
    id: "bybit-public",
    displayName: "Bybit (live public)",
    supports: (s) => toBybit(s) !== null,

    async getCandles(symbol, interval, limit) {
      const sym = toBybit(symbol);
      if (!sym) return [];
      const url = `${BASE}/v5/market/kline?category=spot&symbol=${sym}&interval=${INTERVAL_MAP[interval]}&limit=${Math.min(limit, 1000)}`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`Bybit kline ${r.status}`);
      const j = await r.json() as { result?: { list?: string[][] } };
      const list = j.result?.list ?? [];
      // Bybit returns newest-first; reverse to oldest-first
      const candles: Candle[] = list.slice().reverse().map(row => ({
        ts: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      }));
      return candles;
    },

    async getLastPrice(symbol) {
      const sym = toBybit(symbol);
      if (!sym) throw new Error(`Unsupported symbol ${symbol}`);
      const url = `${BASE}/v5/market/tickers?category=spot&symbol=${sym}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Bybit tickers ${r.status}`);
      const j = await r.json() as { result?: { list?: Array<{ lastPrice: string }> } };
      const p = j.result?.list?.[0]?.lastPrice;
      if (!p) throw new Error(`No ticker for ${sym}`);
      return Number(p);
    },
  };
}
