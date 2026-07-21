// Community & Copy Trading server functions.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---- Profile ----
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [pRes, sRes] = await Promise.all([
      context.supabase.from("public_profiles").select("*").eq("user_id", context.userId).maybeSingle(),
      context.supabase.from("profile_stats").select("*").eq("user_id", context.userId).maybeSingle(),
    ]);
    return { profile: pRes.data, stats: sRes.data };
  });

export const upsertMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    display_name: z.string().min(2).max(40),
    bio: z.string().max(280).optional().nullable(),
    avatar_url: z.string().url().optional().nullable(),
    is_public: z.boolean(),
    allow_copy: z.boolean(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("public_profiles").upsert({
      user_id: context.userId,
      display_name: data.display_name,
      bio: data.bio ?? null,
      avatar_url: data.avatar_url ?? null,
      is_public: data.is_public,
      allow_copy: data.allow_copy && data.is_public,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Recompute stats from user's closed positions + paper account.
export const refreshMyStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [acctR, closedR, followersR] = await Promise.all([
      supabase.from("paper_accounts").select("cash_balance,equity").eq("user_id", userId).maybeSingle(),
      supabase.from("positions").select("realized_pnl,closed_at").eq("user_id", userId).eq("status", "closed"),
      supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", userId),
    ]);
    const closed = closedR.data ?? [];
    const returns = closed.map((r: any) => Number(r.realized_pnl ?? 0));
    const wins = returns.filter(r => r > 0).length;
    const winRate = returns.length ? wins / returns.length : 0;
    const total = returns.reduce((s, r) => s + r, 0);
    const startBal = Number(acctR.data?.cash_balance ?? 10000) - total;
    const totalReturnPct = startBal > 0 ? (total / startBal) * 100 : 0;
    // Sharpe (rough, using per-trade returns as proxy)
    const mean = returns.length ? total / returns.length : 0;
    const variance = returns.length ? returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length : 0;
    const std = Math.sqrt(variance);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
    // Max drawdown from cumulative
    let peak = 0, cum = 0, mdd = 0;
    for (const r of returns) {
      cum += r;
      if (cum > peak) peak = cum;
      const dd = peak > 0 ? ((peak - cum) / peak) * 100 : 0;
      if (dd > mdd) mdd = dd;
    }
    const { error } = await supabase.from("profile_stats").upsert({
      user_id: userId,
      total_return_pct: Number(totalReturnPct.toFixed(2)),
      win_rate: Number(winRate.toFixed(4)),
      sharpe: Number(sharpe.toFixed(3)),
      max_drawdown_pct: Number(mdd.toFixed(2)),
      trades_count: returns.length,
      followers_count: followersR.count ?? 0,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- Leaderboard ----
export const getLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    sort: z.enum(["return", "sharpe", "winRate", "followers"]).default("return"),
    minTrades: z.number().int().min(0).max(1000).default(0),
  }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const col = data.sort === "return" ? "total_return_pct"
      : data.sort === "sharpe" ? "sharpe"
      : data.sort === "winRate" ? "win_rate"
      : "followers_count";
    const { data: statsRows, error } = await context.supabase
      .from("profile_stats")
      .select("user_id,total_return_pct,win_rate,sharpe,max_drawdown_pct,trades_count,followers_count")
      .gte("trades_count", data.minTrades)
      .order(col, { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const ids = (statsRows ?? []).map(r => r.user_id);
    if (ids.length === 0) return { leaders: [] };
    const { data: profileRows } = await context.supabase
      .from("public_profiles")
      .select("user_id,display_name,avatar_url,bio,verified,allow_copy,is_public")
      .in("user_id", ids)
      .eq("is_public", true);
    const profMap = new Map((profileRows ?? []).map(p => [p.user_id, p]));
    const leaders = (statsRows ?? [])
      .filter(r => profMap.has(r.user_id))
      .map(r => ({ ...r, public_profiles: profMap.get(r.user_id) }));
    return { leaders };
  });

// ---- Follows ----
export const toggleFollow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ leaderId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    if (data.leaderId === context.userId) throw new Error("Cannot follow yourself");
    const existing = await context.supabase.from("follows").select("follower_id")
      .eq("follower_id", context.userId).eq("following_id", data.leaderId).maybeSingle();
    if (existing.data) {
      await context.supabase.from("follows").delete()
        .eq("follower_id", context.userId).eq("following_id", data.leaderId);
      return { following: false };
    }
    const { error } = await context.supabase.from("follows")
      .insert({ follower_id: context.userId, following_id: data.leaderId });
    if (error) throw new Error(error.message);
    return { following: true };
  });

export const listMyFollowing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("follows")
      .select("following_id").eq("follower_id", context.userId);
    return { ids: (data ?? []).map((r: any) => r.following_id) };
  });

// ---- Copy Trading ----
export const listCopySubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("copy_subscriptions")
      .select("*,public_profiles!copy_subscriptions_leader_id_fkey(display_name,avatar_url,verified)")
      .eq("follower_id", context.userId).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { subscriptions: data ?? [] };
  });

export const upsertCopySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    leaderId: z.string().uuid(),
    allocationPct: z.number().min(1).max(100),
    maxPositionSize: z.number().positive().max(1_000_000),
    active: z.boolean(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    if (data.leaderId === context.userId) throw new Error("Cannot copy yourself");
    // Verify leader allows copy
    const leader = await context.supabase.from("public_profiles")
      .select("allow_copy,is_public").eq("user_id", data.leaderId).maybeSingle();
    if (!leader.data?.is_public || !leader.data?.allow_copy) {
      throw new Error("This trader does not accept copiers");
    }
    const { error } = await context.supabase.from("copy_subscriptions").upsert({
      follower_id: context.userId,
      leader_id: data.leaderId,
      allocation_pct: data.allocationPct,
      max_position_size: data.maxPositionSize,
      active: data.active,
      updated_at: new Date().toISOString(),
    }, { onConflict: "follower_id,leader_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCopySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ leaderId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await context.supabase.from("copy_subscriptions").delete()
      .eq("follower_id", context.userId).eq("leader_id", data.leaderId);
    return { ok: true };
  });
