import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  listFactors, listHypotheses, createHypothesis, updateHypothesis,
  deleteHypothesis, evaluateHypothesis, type HypothesisRow,
} from "@/lib/research.functions";
import type { Condition, HypothesisDSL, Op } from "@/lib/research/dsl";
import { FlaskConical, Plus, Play, Trash2, CheckCircle2, XCircle, Rocket, Loader2, Beaker, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/research")({
  head: () => ({
    meta: [
      { title: "AI Research Lab — NeurlX" },
      { name: "description", content: "Formulate strategy hypotheses in a safe factor DSL, run them against real cached market data, and track validation outcomes over time." },
    ],
  }),
  component: ResearchPage,
});

const OPS: Op[] = [">", ">=", "<", "<=", "==", "cross_above", "cross_below"];
const STATUS_TONE: Record<string, string> = {
  draft: "bg-secondary/40 text-muted-foreground border-border",
  validated: "bg-success/10 text-success border-success/40",
  rejected: "bg-destructive/10 text-destructive border-destructive/40",
  promoted: "bg-primary/10 text-primary border-primary/40",
};

function ResearchPage() {
  const qc = useQueryClient();
  const fetchFactors = useServerFn(listFactors);
  const fetchList = useServerFn(listHypotheses);
  const create = useServerFn(createHypothesis);
  const update = useServerFn(updateHypothesis);
  const remove = useServerFn(deleteHypothesis);
  const evaluate = useServerFn(evaluateHypothesis);

  const factorsQ = useQuery({ queryKey: ["research-factors"], queryFn: () => fetchFactors() });
  const listQ = useQuery({ queryKey: ["research-list"], queryFn: () => fetchList() });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected: HypothesisRow | null = useMemo(
    () => listQ.data?.rows.find(r => r.id === selectedId) ?? null,
    [listQ.data, selectedId],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["research-list"] });

  const createMut = useMutation({
    mutationFn: async (payload: any) => await create({ data: payload }),
    onSuccess: (r) => { toast.success("Hypothesis created"); setSelectedId(r.id); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create"),
  });
  const updateMut = useMutation({
    mutationFn: async (payload: any) => await update({ data: payload }),
    onSuccess: () => { toast.success("Saved"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });
  const deleteMut = useMutation({
    mutationFn: async (id: string) => await remove({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); setSelectedId(null); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to delete"),
  });
  const evalMut = useMutation({
    mutationFn: async (id: string) => await evaluate({ data: { id } }),
    onSuccess: () => { toast.success("Evaluation complete"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Evaluation failed"),
  });

  return (
    <AppShell>
      <div className="px-4 sm:px-6 py-6 max-w-6xl mx-auto space-y-6">
        <header className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/30 grid place-items-center shrink-0">
            <FlaskConical className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold leading-tight">AI Research Lab</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Formulate hypotheses in a safe factor DSL, backtest against cached market data, and promote what works into strategies.
            </p>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-2">
            <button
              disabled={!factorsQ.data}
              onClick={() => {
                if (!factorsQ.data) return;
                createMut.mutate({
                  name: `Hypothesis ${((listQ.data?.rows.length ?? 0) + 1).toString().padStart(2, "0")}`,
                  symbol: factorsQ.data.symbols[0],
                  interval: "1h",
                  tags: [],
                  dsl: factorsQ.data.template,
                });
              }}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-50">
              <Plus className="w-4 h-4" /> New hypothesis
            </button>

            {listQ.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
            {listQ.data?.rows.length === 0 && (
              <div className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground">
                No hypotheses yet. Create one to start experimenting.
              </div>
            )}
            <div className="space-y-1">
              {(listQ.data?.rows ?? []).map(r => (
                <button key={r.id} onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left rounded-md border px-3 py-2 text-xs transition ${selectedId === r.id ? "border-primary/50 bg-primary/5" : "border-border bg-card hover:bg-secondary/40"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{r.name}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] uppercase font-mono ${STATUS_TONE[r.status]}`}>{r.status}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground flex justify-between">
                    <span>{r.symbol} · {r.interval}</span>
                    {r.last_metrics && (
                      <span className={r.last_metrics.totalReturnPct >= 0 ? "text-success" : "text-destructive"}>
                        {r.last_metrics.totalReturnPct >= 0 ? "+" : ""}{Number(r.last_metrics.totalReturnPct).toFixed(1)}%
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <section>
            {!selected ? (
              <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                <Beaker className="w-6 h-6 mx-auto mb-2 text-primary/60" />
                Select or create a hypothesis to edit its rules and run an evaluation.
              </div>
            ) : (
              <HypothesisEditor
                key={selected.id}
                row={selected}
                factors={factorsQ.data?.factors ?? []}
                symbols={factorsQ.data?.symbols ?? []}
                onSave={(patch) => updateMut.mutate({ id: selected.id, ...patch })}
                onEvaluate={() => evalMut.mutate(selected.id)}
                onDelete={() => deleteMut.mutate(selected.id)}
                onStatus={(status) => updateMut.mutate({ id: selected.id, status })}
                evaluating={evalMut.isPending}
                saving={updateMut.isPending}
              />
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

interface FactorMeta {
  id: string; label: string; category: string; description: string; unit: string | null;
  params: { name: string; default: number; min?: number; max?: number }[];
}

function HypothesisEditor(props: {
  row: HypothesisRow;
  factors: FactorMeta[];
  symbols: string[];
  onSave: (patch: any) => void;
  onEvaluate: () => void;
  onDelete: () => void;
  onStatus: (s: HypothesisRow["status"]) => void;
  evaluating: boolean;
  saving: boolean;
}) {
  const { row, factors, symbols } = props;
  const [name, setName] = useState(row.name);
  const [description, setDescription] = useState(row.description ?? "");
  const [symbol, setSymbol] = useState(row.symbol);
  const [interval, setInterval] = useState(row.interval);
  const [dsl, setDsl] = useState<HypothesisDSL>(row.dsl);

  const conds = dsl.entry.all ?? dsl.entry.any ?? [];
  const combinator: "all" | "any" = dsl.entry.all ? "all" : "any";

  function setCombinator(next: "all" | "any") {
    setDsl(d => ({ ...d, entry: { [next]: conds } as any }));
  }
  function addCondition() {
    const f = factors[0]; if (!f) return;
    const c: Condition = { factor: f.id, op: ">", value: 0 };
    setDsl(d => ({ ...d, entry: { [combinator]: [...conds, c] } as any }));
  }
  function updateCondition(idx: number, patch: Partial<Condition>) {
    const next = conds.map((c, i) => i === idx ? { ...c, ...patch } : c);
    setDsl(d => ({ ...d, entry: { [combinator]: next } as any }));
  }
  function removeCondition(idx: number) {
    setDsl(d => ({ ...d, entry: { [combinator]: conds.filter((_, i) => i !== idx) } as any }));
  }

  function save() {
    props.onSave({ name, description: description || null, dsl });
  }

  const m = row.last_metrics;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input value={name} onChange={e => setName(e.target.value)}
            className="flex-1 min-w-[200px] bg-transparent text-lg font-semibold outline-none border-b border-transparent focus:border-primary/50 pb-1" />
          <span className={`px-2 py-1 rounded border text-[10px] uppercase font-mono ${STATUS_TONE[row.status]}`}>{row.status}</span>
        </div>
        <textarea value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Thesis: why should this work? What edge are you capturing?"
          rows={2}
          className="w-full rounded-md border border-border bg-secondary/30 p-2 text-sm outline-none focus:border-primary/50" />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">
            <span className="text-muted-foreground font-mono">SYMBOL</span>
            <select value={symbol} onChange={e => { setSymbol(e.target.value); props.onSave({ ...({} as any) }); }}
              className="mt-1 w-full h-9 rounded border border-border bg-card px-2 text-sm font-mono">
              {symbols.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground font-mono">INTERVAL</span>
            <select value={interval} onChange={e => setInterval(e.target.value)}
              className="mt-1 w-full h-9 rounded border border-border bg-card px-2 text-sm font-mono">
              {["5m", "15m", "1h", "4h", "1d"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Entry rule</h3>
          <div className="flex items-center gap-1">
            <button onClick={() => setCombinator("all")}
              className={`px-2 py-1 text-[11px] rounded border font-mono ${combinator === "all" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>ALL</button>
            <button onClick={() => setCombinator("any")}
              className={`px-2 py-1 text-[11px] rounded border font-mono ${combinator === "any" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>ANY</button>
          </div>
        </div>
        <div className="space-y-2">
          {conds.map((c, i) => {
            const spec = factors.find(f => f.id === c.factor);
            return (
              <div key={i} className="rounded border border-border p-2 space-y-2 bg-secondary/20">
                <div className="flex flex-wrap items-center gap-2">
                  <select value={c.factor} onChange={e => updateCondition(i, { factor: e.target.value, params: {} })}
                    className="h-8 rounded border border-border bg-card px-2 text-xs font-mono flex-1 min-w-[140px]">
                    {factors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                  <select value={c.op} onChange={e => updateCondition(i, { op: e.target.value as Op })}
                    className="h-8 rounded border border-border bg-card px-2 text-xs font-mono">
                    {OPS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <input type="number" step="0.01" value={c.value} onChange={e => updateCondition(i, { value: parseFloat(e.target.value) || 0 })}
                    className="h-8 w-24 rounded border border-border bg-card px-2 text-xs font-mono" />
                  <span className="text-[10px] text-muted-foreground">{spec?.unit ?? ""}</span>
                  <button onClick={() => removeCondition(i)} className="ml-auto text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {spec && spec.params.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {spec.params.map(p => (
                      <label key={p.name} className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                        {p.name}
                        <input type="number" value={c.params?.[p.name] ?? p.default}
                          onChange={e => updateCondition(i, { params: { ...(c.params ?? {}), [p.name]: parseFloat(e.target.value) || 0 } })}
                          className="h-7 w-16 rounded border border-border bg-card px-1.5 text-xs" />
                      </label>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground">{spec?.description}</div>
              </div>
            );
          })}
          <button onClick={addCondition}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary/30">
            <Plus className="w-3.5 h-3.5" /> Add condition
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold">Risk & exit</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <label>
            <span className="text-muted-foreground font-mono">SIDE</span>
            <select value={dsl.side} onChange={e => setDsl(d => ({ ...d, side: e.target.value as any }))}
              className="mt-1 w-full h-9 rounded border border-border bg-card px-2 font-mono">
              <option value="long">long</option><option value="short">short</option>
            </select>
          </label>
          <label>
            <span className="text-muted-foreground font-mono">RISK %</span>
            <input type="number" step="0.1" value={dsl.risk.riskPct}
              onChange={e => setDsl(d => ({ ...d, risk: { ...d.risk, riskPct: parseFloat(e.target.value) || 0 } }))}
              className="mt-1 w-full h-9 rounded border border-border bg-card px-2 font-mono" />
          </label>
          <label>
            <span className="text-muted-foreground font-mono">STOP × ATR</span>
            <input type="number" step="0.1" value={dsl.risk.stopAtrMult}
              onChange={e => setDsl(d => ({ ...d, risk: { ...d.risk, stopAtrMult: parseFloat(e.target.value) || 0 } }))}
              className="mt-1 w-full h-9 rounded border border-border bg-card px-2 font-mono" />
          </label>
          <label>
            <span className="text-muted-foreground font-mono">TAKE × ATR</span>
            <input type="number" step="0.1" value={dsl.risk.takeAtrMult}
              onChange={e => setDsl(d => ({ ...d, risk: { ...d.risk, takeAtrMult: parseFloat(e.target.value) || 0 } }))}
              className="mt-1 w-full h-9 rounded border border-border bg-card px-2 font-mono" />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={props.saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm font-medium hover:bg-secondary/80 disabled:opacity-50">
          Save changes
        </button>
        <button onClick={props.onEvaluate} disabled={props.evaluating}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-50">
          {props.evaluating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Evaluate
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => props.onStatus("validated")}
            className="inline-flex items-center gap-1 rounded-md border border-success/40 text-success px-2 py-1.5 text-xs hover:bg-success/10">
            <CheckCircle2 className="w-3.5 h-3.5" /> Validate
          </button>
          <button onClick={() => props.onStatus("rejected")}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 text-destructive px-2 py-1.5 text-xs hover:bg-destructive/10">
            <XCircle className="w-3.5 h-3.5" /> Reject
          </button>
          <button onClick={() => props.onStatus("promoted")}
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 text-primary px-2 py-1.5 text-xs hover:bg-primary/10">
            <Rocket className="w-3.5 h-3.5" /> Promote
          </button>
          <button onClick={props.onDelete}
            className="inline-flex items-center gap-1 rounded-md border border-border text-muted-foreground px-2 py-1.5 text-xs hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {m && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Last evaluation</h3>
            <span className="text-[11px] text-muted-foreground font-mono">
              {row.last_run_at ? new Date(row.last_run_at).toLocaleString() : ""}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="Return" value={`${Number(m.totalReturnPct).toFixed(2)}%`} tone={m.totalReturnPct >= 0 ? "success" : "destructive"} icon={m.totalReturnPct >= 0 ? TrendingUp : TrendingDown} />
            <Stat label="Trades" value={m.trades} tone="muted" />
            <Stat label="Win rate" value={`${(m.winRate * 100).toFixed(1)}%`} tone={m.winRate >= 0.5 ? "success" : "muted"} />
            <Stat label="Sharpe" value={Number(m.sharpe).toFixed(2)} tone={m.sharpe >= 1 ? "success" : "muted"} />
            <Stat label="Sortino" value={Number(m.sortino).toFixed(2)} tone="muted" />
            <Stat label="Max DD" value={`${(m.maxDrawdownPct * 100).toFixed(2)}%`} tone="destructive" />
            <Stat label="Profit factor" value={Number(m.profitFactor ?? 0).toFixed(2)} tone={m.profitFactor >= 1.5 ? "success" : "muted"} />
            <Stat label="Expectancy" value={Number(m.expectancy ?? 0).toFixed(2)} tone="muted" />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone, icon: Icon }: { label: string; value: any; tone: "success" | "destructive" | "muted"; icon?: any }) {
  const map = { success: "text-success", destructive: "text-destructive", muted: "text-foreground" } as const;
  return (
    <div className="rounded-md border border-border p-2.5 bg-secondary/20">
      <div className="text-[10px] uppercase text-muted-foreground font-mono">{label}</div>
      <div className={`mt-1 font-mono flex items-center gap-1 ${map[tone]}`}>
        {Icon && <Icon className="w-3.5 h-3.5" />} {value}
      </div>
    </div>
  );
}
