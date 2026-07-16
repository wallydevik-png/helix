import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, PageHeader, fmtUsd, fmtNum } from "@/components/AppShell";
import { approveSignal, listSignals, rejectSignal } from "@/lib/trading.functions";
import { toast } from "sonner";
import { Check, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({ meta: [{ title: "Approvals — Helix" }, { name: "robots", content: "noindex" }] }),
  component: Approvals,
});

function Approvals() {
  const fetchFn = useServerFn(listSignals);
  const approve = useServerFn(approveSignal);
  const reject = useServerFn(rejectSignal);
  const qc = useQueryClient();

  const { data: all = [] } = useQuery({
    queryKey: ["signals"], queryFn: () => fetchFn(), refetchInterval: 10000,
  });
  const pending = all.filter(s => s.status === "pending");

  async function onApprove(id: string) {
    try {
      await approve({ data: { signalId: id } });
      toast.success("Trade executed");
      qc.invalidateQueries();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Rejected by risk gate"); }
  }
  async function onReject(id: string) {
    try {
      await reject({ data: { signalId: id } });
      toast.success("Signal rejected");
      qc.invalidateQueries();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <AppShell>
      <PageHeader title="Trade Approvals" subtitle="Every AI-proposed trade requires your explicit approval in Assisted mode." />

      {pending.length === 0 ? (
        <div className="panel p-10 text-center text-muted-foreground text-sm">
          No pending approvals. Generate a signal from the AI Signals page.
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map(s => (
            <div key={s.id} className="panel p-6">
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <div className="text-lg font-semibold font-mono">{s.symbol}</div>
                    <span className={`text-xs uppercase font-mono px-2 py-0.5 rounded ${
                      s.side === "buy" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
                    }`}>{s.side}</span>
                    <span className="text-xs text-muted-foreground">
                      Expires {s.expires_at ? new Date(s.expires_at).toLocaleTimeString() : "soon"}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <Info k="Entry price" v={fmtUsd(s.entry)} />
                    <Info k="Position size" v={fmtNum(s.qty, 6) + " · " + fmtUsd(Number(s.entry) * Number(s.qty))} />
                    <Info k="AI confidence" v={<span className="text-success">{(Number(s.confidence) * 100).toFixed(0)}%</span>} />
                    <Info k="Stop loss" v={<span className="text-destructive">{fmtUsd(s.stop_loss)}</span>} />
                    <Info k="Take profit" v={<span className="text-success">{fmtUsd(s.take_profit)}</span>} />
                    <Info k="Risk / reward" v={fmtNum(s.risk_reward, 2) + "×"} />
                  </div>

                  <div className="mt-4 p-3 rounded-md border border-border bg-secondary/30">
                    <div className="text-[10px] uppercase font-mono text-muted-foreground mb-1">AI reasoning</div>
                    <p className="text-sm">{s.reasoning}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-2 shrink-0">
                  <button onClick={() => onApprove(s.id)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-success px-4 py-2 text-sm font-medium text-success-foreground">
                    <Check className="w-4 h-4" /> Approve
                  </button>
                  <button onClick={() => onReject(s.id)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary">
                    <X className="w-4 h-4" /> Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase font-mono text-muted-foreground">{k}</div>
      <div className="font-mono mt-0.5">{v}</div>
    </div>
  );
}
