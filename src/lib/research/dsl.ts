// Research Lab DSL — JSON-only, no code eval. A hypothesis is a set of rules;
// each rule combines factor conditions with AND/OR. The runner evaluates the
// active rule set on each bar to produce entry/exit decisions.

export type Op = ">" | ">=" | "<" | "<=" | "==" | "cross_above" | "cross_below";

export interface Condition {
  factor: string;                          // factor id from FACTOR_MAP
  params?: Record<string, number>;         // overrides for factor defaults
  op: Op;
  value: number;
}

export interface RuleGroup {
  all?: Condition[];                       // AND
  any?: Condition[];                       // OR
}

export interface HypothesisDSL {
  side: "long" | "short" | "both";
  entry: RuleGroup;                        // required
  exit?: RuleGroup;                        // optional; SL/TP still apply
  risk: {
    stopAtrMult: number;                   // stop distance in ATR multiples
    takeAtrMult: number;                   // take-profit distance in ATR multiples
    riskPct: number;                       // % of equity risked per trade
    maxBarsInTrade?: number;               // hard time exit
  };
}

export function emptyDSL(): HypothesisDSL {
  return {
    side: "long",
    entry: { all: [{ factor: "rsi", op: "<", value: 30 }] },
    risk: { stopAtrMult: 2, takeAtrMult: 3, riskPct: 1, maxBarsInTrade: 40 },
  };
}

export function validateDSL(dsl: unknown): { ok: true; dsl: HypothesisDSL } | { ok: false; error: string } {
  try {
    const d = dsl as HypothesisDSL;
    if (!d || typeof d !== "object") return { ok: false, error: "DSL must be an object" };
    if (!["long", "short", "both"].includes(d.side)) return { ok: false, error: "side must be long/short/both" };
    if (!d.entry || (!d.entry.all?.length && !d.entry.any?.length)) return { ok: false, error: "entry rule required" };
    if (!d.risk || d.risk.stopAtrMult <= 0 || d.risk.takeAtrMult <= 0 || d.risk.riskPct <= 0)
      return { ok: false, error: "risk block invalid" };
    return { ok: true, dsl: d };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "invalid DSL" };
  }
}
