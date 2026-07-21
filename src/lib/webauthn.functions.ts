import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PASSKEYS_UNAVAILABLE =
  "Passkey registration is temporarily unavailable while NeurlX uses the edge-safe mobile security flow.";

const registrationOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    throw new Error(PASSKEYS_UNAVAILABLE);
  });

const verifyRegistration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      response: z.record(z.any()),
      nickname: z.string().max(50).optional(),
    }).parse(d),
  )
  .handler(async () => {
    throw new Error(PASSKEYS_UNAVAILABLE);
  });

const authenticationOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    throw new Error(PASSKEYS_UNAVAILABLE);
  });

const verifyAuthentication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ response: z.record(z.any()) }).parse(d),
  )
  .handler(async () => {
    throw new Error(PASSKEYS_UNAVAILABLE);
  });

const listCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("webauthn_credentials")
      .select("id,credential_id,nickname,device_type,backed_up,created_at,last_used_at,is_active")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const removeCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("webauthn_credentials")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    await supabase.from("audit_log").insert({
      user_id: userId,
      action: "webauthn.removed",
      entity: "webauthn_credentials",
      metadata: { id: data.id } as never,
    });
    return { ok: true };
  });

export {
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
  listCredentials,
  removeCredential,
};
