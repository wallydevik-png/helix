import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import {
  getMyProfile, upsertMyProfile, refreshMyStats, getLeaderboard,
  toggleFollow, listMyFollowing, listCopySubscriptions,
  upsertCopySubscription, deleteCopySubscription,
} from "@/lib/community.functions";
import { Trophy, UserCheck, UserPlus, Copy, RefreshCw, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/community")({
  component: CommunityPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Failed to load: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type SortKey = "return" | "sharpe" | "winRate" | "followers";

function CommunityPage() {
  const qc = useQueryClient();
  const profileFn = useServerFn(getMyProfile);
  const upsertProfileFn = useServerFn(upsertMyProfile);
  const refreshFn = useServerFn(refreshMyStats);
  const leaderboardFn = useServerFn(getLeaderboard);
  const followFn = useServerFn(toggleFollow);
  const followingFn = useServerFn(listMyFollowing);
  const copyListFn = useServerFn(listCopySubscriptions);
  const copyUpsertFn = useServerFn(upsertCopySubscription);
  const copyDeleteFn = useServerFn(deleteCopySubscription);

  const [tab, setTab] = useState<"leaderboard" | "copies" | "profile">("leaderboard");
  const [sort, setSort] = useState<SortKey>("return");
  const [copyModal, setCopyModal] = useState<{ leaderId: string; name: string } | null>(null);

  const profile = useQuery({ queryKey: ["community-profile"], queryFn: () => profileFn() });
  const leaders = useQuery({
    queryKey: ["community-leaderboard", sort],
    queryFn: () => leaderboardFn({ data: { sort, minTrades: 0 } }),
  });
  const following = useQuery({ queryKey: ["community-following"], queryFn: () => followingFn() });
  const copies = useQuery({ queryKey: ["community-copies"], queryFn: () => copyListFn() });

  const followMut = useMutation({
    mutationFn: (leaderId: string) => followFn({ data: { leaderId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["community-following"] });
      qc.invalidateQueries({ queryKey: ["community-leaderboard", sort] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const followingSet = new Set(following.data?.ids ?? []);

  return (
    <AppShell>
      <PageHeader title="Community" subtitle="Leaderboard, followers, and copy trading." />
      <div className="flex gap-2 mb-4 border-b border-border">
        {(["leaderboard", "copies", "profile"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize border-b-2 -mb-px ${
              tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "leaderboard" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="text-sm text-muted-foreground">Sort by:</span>
            {([["return","Return"],["sharpe","Sharpe"],["winRate","Win Rate"],["followers","Followers"]] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setSort(k as SortKey)}
                className={`px-3 py-1 rounded-md text-xs border ${
                  sort === k ? "bg-primary text-primary-foreground border-primary" : "border-border"
                }`}
              >{l}</button>
            ))}
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Trader</th>
                  <th className="text-right px-3 py-2">Return</th>
                  <th className="text-right px-3 py-2 hidden sm:table-cell">Win%</th>
                  <th className="text-right px-3 py-2 hidden md:table-cell">Sharpe</th>
                  <th className="text-right px-3 py-2 hidden md:table-cell">Max DD</th>
                  <th className="text-right px-3 py-2 hidden sm:table-cell">Trades</th>
                  <th className="text-right px-3 py-2">Followers</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(leaders.data?.leaders ?? []).map((row: any) => {
                  const p = row.public_profiles;
                  const isFollowing = followingSet.has(row.user_id);
                  return (
                    <tr key={row.user_id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-medium">
                            {p?.display_name?.[0]?.toUpperCase() ?? "?"}
                          </div>
                          <div>
                            <div className="font-medium flex items-center gap-1">
                              {p?.display_name}
                              {p?.verified && <ShieldCheck className="h-3.5 w-3.5 text-primary" />}
                            </div>
                            {p?.bio && <div className="text-xs text-muted-foreground line-clamp-1">{p.bio}</div>}
                          </div>
                        </div>
                      </td>
                      <td className={`text-right px-3 py-2 font-mono ${Number(row.total_return_pct) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                        {Number(row.total_return_pct).toFixed(2)}%
                      </td>
                      <td className="text-right px-3 py-2 hidden sm:table-cell font-mono">{(Number(row.win_rate) * 100).toFixed(1)}%</td>
                      <td className="text-right px-3 py-2 hidden md:table-cell font-mono">{Number(row.sharpe).toFixed(2)}</td>
                      <td className="text-right px-3 py-2 hidden md:table-cell font-mono">{Number(row.max_drawdown_pct).toFixed(2)}%</td>
                      <td className="text-right px-3 py-2 hidden sm:table-cell font-mono">{row.trades_count}</td>
                      <td className="text-right px-3 py-2 font-mono">{row.followers_count}</td>
                      <td className="text-right px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => followMut.mutate(row.user_id)}
                            className={`px-2 py-1 rounded-md text-xs border ${
                              isFollowing ? "bg-accent border-border" : "border-primary text-primary"
                            }`}
                          >
                            {isFollowing ? <><UserCheck className="h-3 w-3 inline mr-1" />Following</> : <><UserPlus className="h-3 w-3 inline mr-1" />Follow</>}
                          </button>
                          {p?.allow_copy && (
                            <button
                              onClick={() => setCopyModal({ leaderId: row.user_id, name: p.display_name })}
                              className="px-2 py-1 rounded-md text-xs border border-primary text-primary"
                            >
                              <Copy className="h-3 w-3 inline mr-1" />Copy
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {leaders.data?.leaders?.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                    No public traders yet. Set your profile to public in the Profile tab to appear here.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "copies" && (
        <div className="space-y-3">
          {(copies.data?.subscriptions ?? []).map((s: any) => (
            <div key={s.id} className="border border-border rounded-lg p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{s.public_profiles?.display_name ?? "Trader"}</div>
                <div className="text-xs text-muted-foreground">
                  Allocation {s.allocation_pct}% · Max position ${Number(s.max_position_size).toFixed(0)} · {s.active ? "Active" : "Paused"}
                </div>
              </div>
              <button
                onClick={() => copyDeleteFn({ data: { leaderId: s.leader_id } }).then(() => {
                  qc.invalidateQueries({ queryKey: ["community-copies"] });
                  toast.success("Copy subscription removed");
                })}
                className="text-destructive text-xs px-2 py-1 rounded-md border border-border hover:bg-destructive/10"
              >Remove</button>
            </div>
          ))}
          {copies.data?.subscriptions?.length === 0 && (
            <p className="text-sm text-muted-foreground">You are not copying any trader. Find one on the leaderboard.</p>
          )}
        </div>
      )}

      {tab === "profile" && <ProfileEditor
        initial={profile.data?.profile}
        stats={profile.data?.stats}
        onSave={async (d) => { await upsertProfileFn({ data: d }); qc.invalidateQueries({ queryKey: ["community-profile"] }); toast.success("Profile saved"); }}
        onRefresh={async () => { await refreshFn(); qc.invalidateQueries({ queryKey: ["community-profile"] }); qc.invalidateQueries({ queryKey: ["community-leaderboard", sort] }); toast.success("Stats refreshed"); }}
      />}

      {copyModal && (
        <CopyModal
          leader={copyModal}
          onClose={() => setCopyModal(null)}
          onSave={async (allocationPct, maxPositionSize) => {
            try {
              await copyUpsertFn({ data: { leaderId: copyModal.leaderId, allocationPct, maxPositionSize, active: true } });
              qc.invalidateQueries({ queryKey: ["community-copies"] });
              toast.success(`Now copying ${copyModal.name}`);
              setCopyModal(null);
            } catch (e: any) { toast.error(e.message); }
          }}
        />
      )}
    </AppShell>
  );
}

function ProfileEditor({ initial, stats, onSave, onRefresh }: {
  initial: any; stats: any;
  onSave: (d: any) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [isPublic, setIsPublic] = useState(initial?.is_public ?? false);
  const [allowCopy, setAllowCopy] = useState(initial?.allow_copy ?? false);
  return (
    <div className="max-w-2xl space-y-4">
      <div className="border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium">Public Profile</h3>
        <div>
          <label className="text-xs text-muted-foreground">Display name</label>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)}
            className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Bio</label>
          <textarea value={bio ?? ""} onChange={e => setBio(e.target.value)} rows={3} maxLength={280}
            className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
          Show on public leaderboard
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allowCopy} onChange={e => setAllowCopy(e.target.checked)} disabled={!isPublic} />
          Allow others to copy my trades
        </label>
        <button
          onClick={() => onSave({ display_name: displayName, bio, is_public: isPublic, allow_copy: allowCopy, avatar_url: null })}
          disabled={!displayName || displayName.length < 2}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
        >Save profile</button>
      </div>
      <div className="border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Your Stats</h3>
          <button onClick={onRefresh} className="text-xs flex items-center gap-1 text-primary">
            <RefreshCw className="h-3 w-3" /> Recompute
          </button>
        </div>
        {stats ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <Stat label="Return" value={`${Number(stats.total_return_pct).toFixed(2)}%`} />
            <Stat label="Win Rate" value={`${(Number(stats.win_rate) * 100).toFixed(1)}%`} />
            <Stat label="Sharpe" value={Number(stats.sharpe).toFixed(2)} />
            <Stat label="Max DD" value={`${Number(stats.max_drawdown_pct).toFixed(2)}%`} />
            <Stat label="Trades" value={String(stats.trades_count)} />
            <Stat label="Followers" value={String(stats.followers_count)} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No stats yet. Click Recompute after you close some trades.</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

function CopyModal({ leader, onClose, onSave }: {
  leader: { leaderId: string; name: string };
  onClose: () => void;
  onSave: (allocationPct: number, maxPositionSize: number) => void;
}) {
  const [alloc, setAlloc] = useState(10);
  const [maxSize, setMaxSize] = useState(100);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg border border-border p-6 max-w-md w-full space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Copy {leader.name}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Allocation of your capital (%)</label>
          <input type="number" min={1} max={100} value={alloc} onChange={e => setAlloc(Number(e.target.value))}
            className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Max position size (USD)</label>
          <input type="number" min={1} value={maxSize} onChange={e => setMaxSize(Number(e.target.value))}
            className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </div>
        <p className="text-xs text-muted-foreground">
          Copy trading mirrors this trader's future signals into your account with your risk caps.
          Past performance does not guarantee future results.
        </p>
        <button
          onClick={() => onSave(alloc, maxSize)}
          className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm"
        >Start copying</button>
      </div>
    </div>
  );
}
