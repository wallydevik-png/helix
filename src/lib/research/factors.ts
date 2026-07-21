// Factor library — named, parameterized signals derived from candle history.
// Each factor exposes metadata and an evaluator that returns a numeric score
// on the closing bar. Add a factor here to make it available in the DSL.
import type { Candle } from "@/lib/analysis/indicators";
import { sma, ema, rsi, macd, bollinger, atr } from "@/lib/analysis/indicators";

export type FactorCategory = "trend" | "momentum" | "volatility" | "volume" | "meanrev";

export interface FactorSpec {
  id: string;
  label: string;
  category: FactorCategory;
  description: string;
  params: { name: string; default: number; min?: number; max?: number }[];
  /** Returns a numeric value for the latest bar, or null if not enough data. */
  eval: (candles: Candle[], params: Record<string, number>) => number | null;
  /** Human-friendly units suffix, e.g. "%", "σ". */
  unit?: string;
}

const closes = (c: Candle[]) => c.map(x => x.close);

export const FACTORS: FactorSpec[] = [
  {
    id: "rsi", label: "RSI", category: "momentum",
    description: "Relative Strength Index. <30 oversold, >70 overbought.",
    params: [{ name: "period", default: 14, min: 2, max: 100 }],
    eval: (c, p) => rsi(closes(c), Math.round(p.period)),
  },
  {
    id: "ema_slope", label: "EMA slope", category: "trend",
    description: "Percent change of EMA vs. its value `lookback` bars ago.",
    params: [
      { name: "period", default: 20, min: 3, max: 200 },
      { name: "lookback", default: 5, min: 1, max: 50 },
    ],
    eval: (c, p) => {
      const period = Math.round(p.period), lb = Math.round(p.lookback);
      if (c.length < period + lb) return null;
      const cs = closes(c);
      const now = ema(cs, period);
      const then = ema(cs.slice(0, cs.length - lb), period);
      if (now == null || then == null || then === 0) return null;
      return ((now - then) / Math.abs(then)) * 100;
    },
    unit: "%",
  },
  {
    id: "price_vs_sma", label: "Price vs SMA", category: "trend",
    description: "% distance of close from SMA(period).",
    params: [{ name: "period", default: 50, min: 5, max: 400 }],
    eval: (c, p) => {
      const cs = closes(c); const s = sma(cs, Math.round(p.period));
      if (s == null || s === 0) return null;
      return ((cs[cs.length - 1] - s) / s) * 100;
    },
    unit: "%",
  },
  {
    id: "macd_hist", label: "MACD histogram", category: "momentum",
    description: "MACD histogram (line − signal).",
    params: [
      { name: "fast", default: 12 }, { name: "slow", default: 26 }, { name: "signal", default: 9 },
    ],
    eval: (c, p) => {
      const m = macd(closes(c), Math.round(p.fast), Math.round(p.slow), Math.round(p.signal));
      return m ? m.histogram : null;
    },
  },
  {
    id: "bb_position", label: "Bollinger position", category: "meanrev",
    description: "0 at lower band, 1 at upper band, 0.5 at mid.",
    params: [{ name: "period", default: 20 }, { name: "mult", default: 2 }],
    eval: (c, p) => {
      const b = bollinger(closes(c), Math.round(p.period), p.mult);
      if (!b) return null;
      const last = c[c.length - 1].close;
      const range = b.upper - b.lower;
      if (range === 0) return 0.5;
      return (last - b.lower) / range;
    },
  },
  {
    id: "atr_pct", label: "ATR %", category: "volatility",
    description: "ATR(period) as % of the latest close.",
    params: [{ name: "period", default: 14 }],
    eval: (c, p) => {
      const a = atr(c, Math.round(p.period));
      const last = c[c.length - 1]?.close;
      if (a == null || !last) return null;
      return (a / last) * 100;
    },
    unit: "%",
  },
  {
    id: "volume_z", label: "Volume z-score", category: "volume",
    description: "z-score of latest volume vs SMA(period) of volume.",
    params: [{ name: "period", default: 20 }],
    eval: (c, p) => {
      const period = Math.round(p.period);
      if (c.length < period) return null;
      const vols = c.slice(-period).map(x => x.volume);
      const mean = vols.reduce((s, v) => s + v, 0) / vols.length;
      const variance = vols.reduce((s, v) => s + (v - mean) ** 2, 0) / vols.length;
      const std = Math.sqrt(variance);
      const last = c[c.length - 1].volume;
      if (std === 0) return 0;
      return (last - mean) / std;
    },
    unit: "σ",
  },
  {
    id: "return_pct", label: "Return %", category: "momentum",
    description: "Percent return over the last `lookback` bars.",
    params: [{ name: "lookback", default: 10 }],
    eval: (c, p) => {
      const lb = Math.round(p.lookback);
      if (c.length < lb + 1) return null;
      const from = c[c.length - 1 - lb].close;
      const to = c[c.length - 1].close;
      if (from === 0) return null;
      return ((to - from) / from) * 100;
    },
    unit: "%",
  },
];

export const FACTOR_MAP: Record<string, FactorSpec> = Object.fromEntries(FACTORS.map(f => [f.id, f]));
