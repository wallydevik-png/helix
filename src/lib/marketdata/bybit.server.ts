// Real market data from Bybit v5 public endpoints (no auth required).
// Covers crypto symbols; stocks fall through to synthetic.
import type { Candle, Interval, MarketDataProvider } from "./types";

// Bybit's primary public endpoint is occasionally geo-blocked from some edge
// regions. Try Bybit's official alternate hosts before allowing the market
// scanner to fail the whole autonomous cycle.
const BYBIT_BASE_URLS = [
  "https://api.bybit.com",
  "https://api.bytick.com",
  "https://api.bybit.nl",
  "https://api.bybit.kz",
  "https://api.bybit-tr.com",
];

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
  async function getJson<T>(path: string, params: Record<string, string>, label: string): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    let lastError: unknown = null;
    for (const base of BYBIT_BASE_URLS) {
      try {
        const r = await fetch(`${base}${path}?${qs}`, { headers: { Accept: "application/json" } });
        const text = await r.text();
        if (!r.ok) throw new Error(`Bybit ${label} ${r.status}: ${text.slice(0, 180)}`);
        return (text ? JSON.parse(text) : {}) as T;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Bybit ${label} unavailable`);
  }

  return {
    id: "bybit-public",
    displayName: "Bybit (live public)",
    supports: (s) => toBybit(s) !== null,

    async getCandles(symbol, interval, limit) {
      const sym = toBybit(symbol);
      if (!sym) return [];
      const j = await getJson<{ result?: { list?: string[][] } }>("/v5/market/kline", {
        category: "spot",
        symbol: sym,
        interval: INTERVAL_MAP[interval],
        limit: String(Math.min(limit, 1000)),
      }, "kline");
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
      const j = await getJson<{ result?: { list?: Array<{ lastPrice: string }> } }>("/v5/market/tickers", {
        category: "spot",
        symbol: sym,
      }, "tickers");
      const p = j.result?.list?.[0]?.lastPrice;
      if (!p) throw new Error(`No ticker for ${sym}`);
      return Number(p);
    },
  };
}
