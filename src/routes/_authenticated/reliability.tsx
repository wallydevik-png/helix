import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell, PageHeader, Metric } from "@/components/AppShell";
import {
  getReliabilityDashboard, runWatchdog, runSelfCheck,
  captureStateSnapshot, runReconcile, setSystemMode,
} from "@/lib/reliability.functions";
import { Activity, ShieldAlert, HeartPulse, Database, RefreshCw, Camera, Power, PlayCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reliability")({
  head: () => ({ meta: [
    { title: "Reliability — NeurlX" },
    { name: "description", content: "System health, watchdog, state recovery, and degraded-mode controls." },
    { name: "robots", content: "noindex" },
  ]}),
  component: ReliabilityPage,
});

type Dash = {
  status: { mode: string; reason: string | null; degraded_since: string | null; last_watchdog_at: string | null };
  components: { component: string; status: string; latency_ms: number | null; ageSec: number | null; stale: boolean }[];
  healthScore: number;
  snapshots: { id: string; kind: string; captured_at: string }[];
  events: { id: string; event_type: string; severity: string; message: string; created_at: string }[];
};

function statusColor(s: string) {
  if (s === "ok") return "text-success";
  if (s === "warn") return "text-warning";
  if (s === "error" || s === "stale") return "text-destructive";
  return "text-muted-foreground";
}
function modeColor(m: string) {
  if (m === "normal") return "bg-success/15 text-success border-success/30";
  if (m === "degraded") return "bg-warning/15 text-warning border-warning/30";
  if (m === "recovery") return "bg-primary/15 text-primary border-primary/30";
  return "bg-destructive/15 text-destructive border-destructive/30";
}
function sevColor(s: string) {
  if (s === "critical" || s === "error") return "text-destructive";
  if (s === "warn") return "text-warning";
  return "text-muted-foreground";
}

function ReliabilityPage() {
  const qc = useQueryClient();
  const fetchDash = useServerFn(getReliabilityDashboard);
  const wd = useServerFn(runWatchdog);
  const sc = useServerFn(runSelfCheck);
  const snap = useServerFn(captureStateSnapshot);
  const rec = useServerFn(runReconcile);
  const setMode = useServerFn(setSystemMode);

  const q = useQuery<Dash>({ queryKey: ["reliability-dash"], queryFn: () => fetchDash() as Promise<Dash>, refetchInterval: 30000 });

  const inv = () => qc.invalidateQueries({ queryKey: ["reliability-dash"] });
  const mWd = useMutation({ mutationFn: () => wd(), onSuccess: () => { toast.success("Watchdog run complete"); inv(); } });
  const mSc = useMutation({ mutationFn: () => sc(), onSuccess: () => { toast.success("Self-check complete"); inv(); } });
  const mSnap = useMutation({ mutationFn: () => snap(), onSuccess: () => { toast.success("State snapshot captured"); inv(); } });
  const mRec = useMutation({ mutationFn: () => rec(), onSuccess: (r: { drift: number }) => { toast.success(`Reconcile complete — ${r.drift} drift item(s)`); inv(); } });
  const mMode = useMutation({
    mutationFn: (mode: "normal" | "degraded" | "recovery" | "halted") => setMode({ data: { mode, reason: `Manual: ${mode}` } }),
    onSuccess: () => { toast.success("Mode updated"); inv(); },
  });

  const d = q.data;

  return (
    <AppShell>
      <PageHeader
        title="Institutional Reliability"
        subtitle="Component heartbeats, degraded-mode watchdog, and state recovery for 99.99% uptime posture."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Health Score" value={d ? `${d.healthScore}` : "—"} accent={d && d.healthScore >= 80 ? "success" : d && d.healthScore >= 50 ? "warning" : "danger"} />
        <Metric label="Operating Mode" value={d ? d.status.mode.toUpperCase() : "—"} accent={d?.status.mode === "normal" ? "success" : d?.status.mode === "halted" ? "danger" : "warning"} />
        <Metric label="Components OK" value={d ? `${d.components.filter(c => c.status === "ok").length}/${d.components.length}` : "—"} />
        <Metric label="Last Watchdog" value={d?.status.last_watchdog_at ? new Date(d.status.last_watchdog_at).toLocaleTimeString() : "Never"} />
      </div>

      {d?.status.mode !== "normal" && d?.status.reason && (
        <div className={`rounded-lg border p-3 flex items-start gap-2 ${modeColor(d.status.mode)}`}>
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-xs font-mono">
            <div className="font-semibold uppercase">{d.status.mode} mode active</div>
            <div className="opacity-80">{d.status.reason}</div>
            {d.status.degraded_since && <div className="opacity-60 mt-0.5">Since {new Date(d.status.degraded_since).toLocaleString()}</div>}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><HeartPulse className="w-4 h-4 text-primary" /><h3 className="font-semibold text-sm">Component Health</h3></div>
            <div className="flex gap-1.5">
              <button onClick={() => mSc.mutate()} disabled={mSc.isPending} className="text-xs px-2 py-1 rounded border border-border hover:bg-secondary/50 disabled:opacity-50 inline-flex items-center gap-1">
                <PlayCircle className="w-3 h-3" /> Self-check
              </button>
              <button onClick={() => mWd.mutate()} disabled={mWd.isPending} className="text-xs px-2 py-1 rounded border border-border hover:bg-secondary/50 disabled:opacity-50 inline-flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Watchdog
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            {(d?.components ?? []).map(c => (
              <div key={c.component} className="flex items-center justify-between text-xs font-mono py-1.5 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${c.status === "ok" ? "bg-success" : c.status === "warn" ? "bg-warning" : c.status === "unknown" ? "bg-muted-foreground/40" : "bg-destructive"}`} />
                  <span>{c.component}</span>
                </div>
                <div className="flex items-center gap-3">
                  {c.latency_ms != null && <span className="text-muted-foreground">{c.latency_ms}ms</span>}
                  <span className="text-muted-foreground">{c.ageSec != null ? `${c.ageSec}s ago` : "—"}</span>
                  <span className={`uppercase ${statusColor(c.status)}`}>{c.status}</span>
                </div>
              </div>
            ))}
            {!d?.components.length && <div className="text-xs text-muted-foreground">No heartbeats yet. Run Self-check to populate.</div>}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Database className="w-4 h-4 text-primary" /><h3 className="font-semibold text-sm">State Recovery</h3></div>
            <div className="flex gap-1.5">
              <button onClick={() => mSnap.mutate()} disabled={mSnap.isPending} className="text-xs px-2 py-1 rounded border border-border hover:bg-secondary/50 disabled:opacity-50 inline-flex items-center gap-1">
                <Camera className="w-3 h-3" /> Snapshot
              </button>
              <button onClick={() => mRec.mutate()} disabled={mRec.isPending} className="text-xs px-2 py-1 rounded border border-border hover:bg-secondary/50 disabled:opacity-50 inline-flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Reconcile
              </button>
            </div>
          </div>
          <div className="space-y-1">
            {(d?.snapshots ?? []).slice(0, 10).map(s => (
              <div key={s.id} className="flex justify-between text-xs font-mono py-1 border-b border-border/50 last:border-0">
                <span className="uppercase text-muted-foreground">{s.kind}</span>
                <span>{new Date(s.captured_at).toLocaleString()}</span>
              </div>
            ))}
            {!d?.snapshots.length && <div className="text-xs text-muted-foreground">No snapshots yet.</div>}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><Power className="w-4 h-4 text-primary" /><h3 className="font-semibold text-sm">Manual Mode Control</h3></div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Degraded mode blocks new autonomous entries; recovery pauses all automation while reconciling; halted requires manual re-enable.
        </p>
        <div className="flex flex-wrap gap-2">
          {(["normal", "degraded", "recovery", "halted"] as const).map(m => (
            <button
              key={m}
              onClick={() => mMode.mutate(m)}
              disabled={mMode.isPending || d?.status.mode === m}
              className={`text-xs px-3 py-1.5 rounded border transition uppercase font-mono ${d?.status.mode === m ? modeColor(m) : "border-border hover:bg-secondary/50"} disabled:opacity-50`}
            >
              {m}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-primary" /><h3 className="font-semibold text-sm">Recovery Events</h3></div>
        <div className="space-y-1">
          {(d?.events ?? []).map(e => (
            <div key={e.id} className="flex items-start justify-between gap-3 text-xs font-mono py-1.5 border-b border-border/50 last:border-0">
              <div className="min-w-0 flex-1">
                <div className={`font-semibold uppercase ${sevColor(e.severity)}`}>{e.event_type.replace(/_/g, " ")}</div>
                <div className="text-muted-foreground truncate">{e.message}</div>
              </div>
              <span className="text-muted-foreground shrink-0">{new Date(e.created_at).toLocaleTimeString()}</span>
            </div>
          ))}
          {!d?.events.length && <div className="text-xs text-muted-foreground">No events yet.</div>}
        </div>
      </section>
    </AppShell>
  );
}
