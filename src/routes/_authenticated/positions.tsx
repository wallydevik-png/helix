import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, PageHeader, fmtUsd, fmtNum } from "@/components/AppShell";
import { closePosition, listPositions } from "@/lib/trading.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/positions")({
  head: () => ({ meta: [{ title: "Positions — Helix" }, { name: "robots", content: "noindex" }] }),
  component: Positions,
});

function Positions() {
  const fetchFn = useServerFn(listPositions);
  const close = useServerFn(closePosition);
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["positions"], queryFn: () => fetchFn(), refetchInterval: 5000 });
  const open = data.filter(p => p.status === "open");

  async function onClose(id: string) {
    if (!confirm("Close this position at current market?")) return;
    try {
      await close({ data: { positionId: id, reason: "manual" } });
      toast.success("Position closed");
      qc.invalidateQueries();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <AppShell>
      <PageHeader title="Open Positions" subtitle="Live monitoring with mark price, unrealized P&L, and AI reasoning." />
      {open.length === 0 ? (
        <div className="panel p-10 text-center text-muted-foreground text-sm">No open positions.</div>
      ) : (
        <div className="space-y-3">
          {open.map(p => {
            const dir = p.side === "long" ? 1 : -1;
            const pnl = p.currentPrice != null
              ? (Number(p.currentPrice) - Number(p.avg_entry)) * dir * Number(p.qty)
              : 0;
            const pnlPct = p.currentPrice != null
              ? ((Number(p.currentPrice) - Number(p.avg_entry)) / Number(p.avg_entry)) * 100 * dir
              : 0;
            return (
              <div key={p.id} className="panel p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold font-mono">{p.symbol}</span>
                      <span className={`text-xs font-mono uppercase px-1.5 py-0.5 rounded ${
                        p.side === "long" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
                      }`}>{p.side}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 font-mono">
                      Opened {new Date(p.opened_at).toLocaleString()}
                    </div>
                  </div>
                  <button onClick={() => onClose(p.id)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-destructive hover:text-destructive-foreground hover:border-destructive">
                    Close position
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
                  <Cell k="Qty" v={fmtNum(p.qty, 6)} />
                  <Cell k="Entry" v={fmtUsd(p.avg_entry)} />
                  <Cell k="Mark" v={p.currentPrice != null ? fmtUsd(p.currentPrice) : "—"} />
                  <Cell k="Stop" v={p.stop_loss ? fmtUsd(p.stop_loss) : "—"} />
                  <Cell k="Target" v={p.take_profit ? fmtUsd(p.take_profit) : "—"} />
                  <Cell k="Unrealized" v={<span className={pnl >= 0 ? "text-success" : "text-destructive"}>
                    {fmtUsd(pnl)} <span className="text-xs opacity-70">({pnlPct.toFixed(2)}%)</span>
                  </span>} />
                </div>

                {p.ai_reasoning && (
                  <div className="mt-4 p-3 rounded-md border border-border bg-secondary/30 text-sm">
                    <div className="text-[10px] uppercase font-mono text-muted-foreground mb-1">
                      AI reasoning · confidence {((Number(p.ai_confidence ?? 0)) * 100).toFixed(0)}%
                    </div>
                    <p className="text-muted-foreground italic">"{p.ai_reasoning}"</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function Cell({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase font-mono text-muted-foreground">{k}</div>
      <div className="font-mono">{v}</div>
    </div>
  );
}
