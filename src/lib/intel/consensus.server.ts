// Consensus aggregator: weighted average of provider signals.
// Produces a single -1..1 score, 0..1 confidence, and a directional verdict.
import type { IntelSignal } from "./types";
import { REGISTRY } from "./providers.server";

export interface Consensus {
  score: number;        // -1..1
  confidence: number;   // 0..1
  verdict: "Strong Sell" | "Sell" | "Neutral" | "Buy" | "Strong Buy";
  contributors: Array<{ provider: string; weight: number; score: number; confidence: number }>;
}

const weightOf = (id: string) => REGISTRY.find(p => p.id === id)?.weight ?? 0.1;

export function computeConsensus(signals: IntelSignal[]): Consensus {
  if (!signals.length) {
    return { score: 0, confidence: 0, verdict: "Neutral", contributors: [] };
  }
  let num = 0, den = 0, cSum = 0, cN = 0;
  const contributors = signals.map(s => {
    const w = weightOf(s.provider) * s.confidence;
    num += s.score * w;
    den += w;
    cSum += s.confidence; cN += 1;
    return { provider: s.provider, weight: weightOf(s.provider), score: s.score, confidence: s.confidence };
  });
  const score = den > 0 ? num / den : 0;
  const confidence = cN > 0 ? cSum / cN : 0;
  const verdict: Consensus["verdict"] =
    score <= -0.5 ? "Strong Sell" :
    score <= -0.15 ? "Sell" :
    score < 0.15 ? "Neutral" :
    score < 0.5 ? "Buy" : "Strong Buy";
  return { score, confidence, verdict, contributors };
}
