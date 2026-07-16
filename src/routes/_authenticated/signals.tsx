import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, PageHeader, fmtUsd, fmtNum } from "@/components/AppShell";
import { generateAndRouteSignal, listSignals } from "@/lib/trading.functions";
import { toast } from "sonner";
import { Sparkles, TrendingUp, TrendingDown } from "lucide-react";

export const Route = createFileRoute("/_authenticated/signals")({
  head: () => ({ meta: [{ title: "AI Signals — Helix" }, { name: "robots", content: "noindex" }] }),
  component: Signals,
});

function Signals() {
  const fetchFn = useServerFn(listSignals);
  const genFn = useServerFn(generateAndRouteSignal);
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["signals"], queryFn: () => fetchFn(), refetchInterval: 15000 });

  async function generate() {
    try {
      await genFn();
      toast.success("New signal generated");
      qc.invalidateQueries();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <AppShell>
      <PageHeader
        title="AI Signals"
        subtitle="Live feed of AI-generated trade ideas with full rationale."
        action={<button onClick={generate}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          <Sparkles className="w-4 h-4" /> Generate signal
        </button>}
      />

      {data.length === 0 ? (
        <div className="panel p-10 text-center text-muted-foreground text-sm">
          No signals yet. Click "Generate signal" to produce one. In Autonomous mode signals will execute automatically.
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(s => (
            <div key={s.id} className="panel p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-md grid place-items-center ${
                    s.side === "buy" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
                  }`}>
                    {s.side === "buy" ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="font-semibold font-mono">{s.symbol} <span className="text-xs uppercase text-muted-foreground">{s.side}</span></div>
                    <div className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString()}</div>
                  </div>
                </div>
                <StatusBadge status={s.status} />
              </div>

              <p className="mt-4 text-sm text-muted-foreground italic">"{s.reasoning}"</p>

              <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
                <Stat k="Entry" v={fmtUsd(s.entry)} />
                <Stat k="Stop" v={fmtUsd(s.stop_loss)} />
                <Stat k="Target" v={fmtUsd(s.take_profit)} />
                <Stat k="Qty" v={fmtNum(s.qty, 6)} />
                <Stat k="R:R" v={fmtNum(s.risk_reward, 2)} />
                <Stat k="Confidence" v={((Number(s.confidence)) * 100).toFixed(0) + "%"} tone={Number(s.confidence) > 0.75 ? "pos" : undefined} />
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: "pos" }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase text-muted-foreground">{k}</div>
      <div className={`font-mono ${tone === "pos" ? "text-success" : ""}`}>{v}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const c = {
    pending: "bg-warning/15 text-warning",
    executed: "bg-success/15 text-success",
    approved: "bg-success/15 text-success",
    rejected: "bg-destructive/15 text-destructive",
    expired: "bg-muted text-muted-foreground",
  }[status] ?? "bg-muted text-muted-foreground";
  return <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${c}`}>{status}</span>;
}
