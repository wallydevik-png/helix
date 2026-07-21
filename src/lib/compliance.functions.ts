import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const DOC_VERSIONS = {
  tos: "2026-07-01",
  privacy: "2026-07-01",
  risk: "2026-07-01",
} as const;

export const getMyCompliance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [consentsRes, requestsRes, profileRes] = await Promise.all([
      context.supabase.from("user_consents").select("*").eq("user_id", context.userId).maybeSingle(),
      context.supabase.from("gdpr_requests").select("*").eq("user_id", context.userId).order("requested_at", { ascending: false }).limit(50),
      context.supabase.from("profiles").select("deletion_requested_at").eq("id", context.userId).maybeSingle(),
    ]);
    return {
      consents: consentsRes.data,
      requests: requestsRes.data ?? [],
      deletionRequestedAt: profileRes.data?.deletion_requested_at ?? null,
      versions: DOC_VERSIONS,
    };
  });

export const recordConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      tos: z.boolean().optional(),
      privacy: z.boolean().optional(),
      risk: z.boolean().optional(),
      marketing_opt_in: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { user_id: context.userId, updated_at: now };
    if (data.tos) { patch.tos_version = DOC_VERSIONS.tos; patch.tos_accepted_at = now; }
    if (data.privacy) { patch.privacy_version = DOC_VERSIONS.privacy; patch.privacy_accepted_at = now; }
    if (data.risk) { patch.risk_version = DOC_VERSIONS.risk; patch.risk_accepted_at = now; }
    if (typeof data.marketing_opt_in === "boolean") patch.marketing_opt_in = data.marketing_opt_in;
    const { error } = await context.supabase.from("user_consents").upsert(patch, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      user_id: context.userId, action: "consent.recorded", entity: "user_consents", metadata: data as never,
    });
    return { ok: true };
  });

export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tables = [
      "profiles", "user_consents", "paper_accounts", "automation_settings",
      "exchange_connections", "positions", "orders", "signals", "strategies",
      "backtest_runs", "backtest_trades", "shadow_trades", "trade_journal",
      "capital_snapshots", "notifications", "notification_preferences",
      "autonomous_runs", "audit_log", "execution_log",
    ] as const;
    const bundle: Record<string, unknown> = { exported_at: new Date().toISOString(), user_id: context.userId };
    for (const t of tables) {
      const col = t === "profiles" ? "id" : "user_id";
      const { data } = await context.supabase.from(t).select("*").eq(col, context.userId).limit(10000);
      // strip encrypted credentials on export
      if (t === "exchange_connections" && data) {
        for (const r of data as Record<string, unknown>[]) {
          r.encrypted_credentials = "[REDACTED]";
        }
      }
      bundle[t] = data ?? [];
    }
    const { data: req } = await context.supabase.from("gdpr_requests").insert({
      user_id: context.userId, kind: "export", status: "completed", completed_at: new Date().toISOString(),
    }).select().single();
    await context.supabase.from("audit_log").insert({
      user_id: context.userId, action: "gdpr.export", entity: "gdpr_requests", entity_id: req?.id ?? null,
    });
    return { bundle, request: req };
  });

export const requestAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ confirmPhrase: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.confirmPhrase !== "DELETE MY ACCOUNT") {
      throw new Error("Confirmation phrase does not match.");
    }
    // Safety: activate kill switch and revoke all trading permissions immediately
    await context.supabase.from("automation_settings").update({
      kill_switch_active: true, mode: "manual", autonomous_enabled: false,
    }).eq("user_id", context.userId);
    await context.supabase.from("exchange_connections").update({
      trading_enabled: false,
    }).eq("user_id", context.userId);
    await context.supabase.from("profiles").update({
      deletion_requested_at: new Date().toISOString(),
    }).eq("id", context.userId);
    const { data: req } = await context.supabase.from("gdpr_requests").insert({
      user_id: context.userId, kind: "delete", status: "pending",
      notes: "User requested account deletion — 30-day grace period before permanent purge.",
    }).select().single();
    await context.supabase.from("audit_log").insert({
      user_id: context.userId, action: "gdpr.deletion_requested", entity: "gdpr_requests", entity_id: req?.id ?? null,
    });
    return { ok: true, request: req };
  });

export const cancelDeletionRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase.from("profiles").update({ deletion_requested_at: null }).eq("id", context.userId);
    await context.supabase.from("gdpr_requests").update({
      status: "cancelled", completed_at: new Date().toISOString(),
    }).eq("user_id", context.userId).eq("kind", "delete").eq("status", "pending");
    await context.supabase.from("audit_log").insert({
      user_id: context.userId, action: "gdpr.deletion_cancelled", entity: "gdpr_requests",
    });
    return { ok: true };
  });
