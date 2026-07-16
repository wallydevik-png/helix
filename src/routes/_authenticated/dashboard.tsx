import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell, PageHeader, Metric, fmtUsd, fmtPct } from "@/components/AppShell";
import { getDashboard } from "@/lib/trading.functions";
import { Plug, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Helix" }, { name: "robots", content: "noindex" }] }),
  component: Dashboard,
});

function Dashboard() {
  const fetchDash = useServerFn(getDashboard);
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => fetchDash(), refetchInterval: 10000 });

  if (isLoading || !data) return <AppShell><div className="text-muted-foreground">Loading…</div></AppShell>;

  const cash = Number(data.account?.cash_balance ?? 0);
  const unrealized = data.openPositions.reduce((s, _p) => s, 0); // placeholder; computed in positions page
  const equity = cash + unrealized;

  return (
    <AppShell>
      <PageHeader title="Dashboard" subtitle="Portfolio overview and current session activity." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Cash" value={fmtUsd(cash)} sub={data.account?.base_currency ?? "USD"} />
        <Metric label="Equity" value={fmtUsd(equity)} />
        <Metric label="Realized P&L"
          value={fmtUsd(data.metrics.realizedPnl)}
          tone={data.metrics.realizedPnl >= 0 ? "pos" : "neg"} />
        <Metric label="Win rate"
          value={data.metrics.totalClosed ? fmtPct(data.metrics.winRate) : "—"}
          sub={`${data.metrics.totalClosed} closed`} />
      </div>

      <div className="mt-8 grid md:grid-cols-2 gap-4">
        <div className="panel p-6">
          <h2 className="font-semibold">Automation</h2>
          <div className="mt-4 space-y-2 text-sm">
            <Row k="Mode" v={<span className="font-mono uppercase text-primary">{data.settings?.mode ?? "manual"}</span>} />
            <Row k="Risk profile" v={<span className="font-mono uppercase">{data.settings?.risk_level ?? "balanced"}</span>} />
            <Row k="Max trade size" v={fmtUsd(data.settings?.max_trade_size)} />
            <Row k="Daily loss limit" v={fmtUsd(data.settings?.max_daily_loss)} />
            <Row k="Min confidence" v={((data.settings?.min_confidence ?? 0) * 100).toFixed(0) + "%"} />
          </div>
          <Link to="/automation" className="mt-5 inline-flex items-center gap-1 text-sm text-primary hover:underline">
            Adjust settings <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="panel p-6">
          <h2 className="font-semibold flex items-center gap-2"><Plug className="w-4 h-4 text-primary" /> Connected accounts</h2>
          {data.connections.length === 0 ? (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground">No exchanges connected yet. Start with the paper account.</p>
              <Link to="/accounts/new" className="mt-4 inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                Add trading platform
              </Link>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {data.connections.map(c => (
                <li key={c.id} className="py-2.5 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium">{c.label}</div>
                    <div className="text-xs text-muted-foreground font-mono">{c.connector_id} · {c.status}</div>
                  </div>
                  <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                    c.health === "healthy" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                  }`}>{c.health}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-border/50 pb-1.5">
      <span className="text-muted-foreground">{k}</span><span>{v}</span>
    </div>
  );
}
