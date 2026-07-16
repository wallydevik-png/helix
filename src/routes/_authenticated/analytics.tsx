import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell, PageHeader, Metric, fmtUsd, fmtPct } from "@/components/AppShell";
import { listPositions } from "@/lib/trading.functions";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Helix" }, { name: "robots", content: "noindex" }] }),
  component: Analytics,
});

function Analytics() {
  const fetchFn = useServerFn(listPositions);
  const { data = [] } = useQuery({ queryKey: ["positions"], queryFn: () => fetchFn(), refetchInterval: 10000 });

  const closed = data.filter(p => p.status === "closed").sort((a, b) =>
    new Date(a.closed_at ?? 0).getTime() - new Date(b.closed_at ?? 0).getTime());

  const total = closed.length;
  const wins = closed.filter(p => Number(p.realized_pnl) > 0).length;
  const totalPnl = closed.reduce((s, p) => s + Number(p.realized_pnl ?? 0), 0);
  const avgWin = wins > 0
    ? closed.filter(p => Number(p.realized_pnl) > 0).reduce((s, p) => s + Number(p.realized_pnl), 0) / wins
    : 0;
  const losses = total - wins;
  const avgLoss = losses > 0
    ? Math.abs(closed.filter(p => Number(p.realized_pnl) < 0).reduce((s, p) => s + Number(p.realized_pnl), 0)) / losses
    : 0;

  // Equity curve
  let running = 100000;
  const equityCurve = closed.map(p => {
    running += Number(p.realized_pnl ?? 0);
    return { t: p.closed_at ? new Date(p.closed_at).toLocaleDateString() : "", equity: +running.toFixed(2) };
  });
  if (equityCurve.length === 0) equityCurve.push({ t: "start", equity: 100000 });

  // Max drawdown
  let peak = 100000, maxDd = 0;
  equityCurve.forEach(pt => {
    if (pt.equity > peak) peak = pt.equity;
    const dd = (peak - pt.equity) / peak;
    if (dd > maxDd) maxDd = dd;
  });

  return (
    <AppShell>
      <PageHeader title="Analytics" subtitle="Portfolio performance, risk-adjusted returns, and journal metrics." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Realized P&L" value={fmtUsd(totalPnl)} tone={totalPnl >= 0 ? "pos" : "neg"} sub={`${total} trades`} />
        <Metric label="Win rate" value={total ? fmtPct(wins / total) : "—"} sub={`${wins}W / ${losses}L`} />
        <Metric label="Avg win / loss" value={avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) + "×" : "—"} sub={`avg win ${fmtUsd(avgWin)}`} />
        <Metric label="Max drawdown" value={fmtPct(maxDd)} tone="neg" />
      </div>

      <div className="panel p-6 mt-6">
        <h2 className="font-semibold mb-4">Equity curve</h2>
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={equityCurve}>
              <XAxis dataKey="t" stroke="oklch(0.68 0.02 250)" fontSize={11} />
              <YAxis stroke="oklch(0.68 0.02 250)" fontSize={11} domain={["dataMin - 500", "dataMax + 500"]} />
              <Tooltip
                contentStyle={{ background: "oklch(0.18 0.018 250)", border: "1px solid oklch(0.26 0.015 250)", borderRadius: 6, fontSize: 12 }}
                formatter={(v: number) => fmtUsd(v)}
              />
              <Line type="monotone" dataKey="equity" stroke="oklch(0.78 0.16 180)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </AppShell>
  );
}
