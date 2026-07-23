// Production Bybit connector — v5 unified account API.
// Docs: https://bybit-exchange.github.io/docs/v5/intro
//
// Signing (v5): HMAC-SHA256 hex over
//    timestamp + apiKey + recvWindow + (queryString | rawBody)
// Header set: X-BAPI-API-KEY, X-BAPI-TIMESTAMP, X-BAPI-RECV-WINDOW, X-BAPI-SIGN.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ApiPermissionSnapshot, Balance, ConnectionHealth, ConnectorPosition,
  HistoryEntry, PlaceOrderInput, PlaceOrderResult, Quote, TradingConnector,
} from "./types";
import { hmacSha256Hex } from "./signing.server";
import { doRequest } from "./rest.server";

// Rotate through Bybit's official API hosts. Some edge regions receive a
// CloudFront 403 from the primary host, which was stopping live autopilot
// before it could even price or submit a trade.
const BYBIT_BASE_URLS = [
  "https://api.bybit.com",
  "https://api.bytick.com",
  "https://api.bybit.nl",
  "https://api.bybit.kz",
  "https://api.bybit-tr.com",
];
const RECV = "5000";

function toBybit(symbol: string): string {
  if (!symbol.includes("-")) return symbol.toUpperCase();
  const [b, q] = symbol.toUpperCase().split("-");
  return `${b}${q === "USD" ? "USDT" : q}`;
}

export function createBybitConnector(
  credentials: Record<string, string>,
  ctx: { supabase?: SupabaseClient; userId?: string; connectionId?: string | null; orderId?: string | null } = {},
): TradingConnector {
  const apiKey = credentials.apiKey ?? "";
  const apiSecret = credentials.apiSecret ?? "";
  const hasKeys = Boolean(apiKey && apiSecret);
  const logCtx = { ...ctx, venue: "bybit" };

  async function sign(payload: string): Promise<{ ts: string; sig: string }> {
    const ts = Date.now().toString();
    const preSign = ts + apiKey + RECV + payload;
    return { ts, sig: await hmacSha256Hex(apiSecret, preSign) };
  }

  async function publicGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    const qs = params ? new URLSearchParams(params).toString() : "";
    let lastError: unknown = null;
    for (const base of BYBIT_BASE_URLS) {
      try {
        return await doRequest<T>({
          ctx: logCtx, method: "GET",
          url: `${base}${path}${qs ? "?" + qs : ""}`,
          path, params,
        });
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Bybit public API unavailable");
  }

  async function signedGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    if (!hasKeys) throw new Error("Bybit API keys required for signed endpoints");
    const qs = new URLSearchParams(params).toString();
    let lastError: unknown = null;
    for (const base of BYBIT_BASE_URLS) {
      try {
        const { ts, sig } = await sign(qs);
        return await doRequest<T>({
          ctx: logCtx, method: "GET", path,
          url: `${base}${path}${qs ? "?" + qs : ""}`,
          headers: {
            "X-BAPI-API-KEY": apiKey, "X-BAPI-TIMESTAMP": ts,
            "X-BAPI-RECV-WINDOW": RECV, "X-BAPI-SIGN": sig,
          },
          params, signed: true,
        });
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Bybit signed API unavailable");
  }

  async function signedPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    if (!hasKeys) throw new Error("Bybit API keys required for signed endpoints");
    const raw = JSON.stringify(body);
    let lastError: unknown = null;
    for (const base of BYBIT_BASE_URLS) {
      try {
        const { ts, sig } = await sign(raw);
        return await doRequest<T>({
          ctx: logCtx, method: "POST", path, url: `${base}${path}`,
          headers: {
            "Content-Type": "application/json",
            "X-BAPI-API-KEY": apiKey, "X-BAPI-TIMESTAMP": ts,
            "X-BAPI-RECV-WINDOW": RECV, "X-BAPI-SIGN": sig,
          },
          body: raw, params: body, signed: true,
        });
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Bybit signed API unavailable");
  }

  return {
    id: "bybit", displayName: "Bybit", supportsRealExecution: hasKeys,

    async verify() {
      try {
        if (!hasKeys) {
          await publicGet<unknown>("/v5/market/time");
          return { ok: true, message: "Public data only (no API key)" };
        }
        const r = await signedGet<{ retCode: number; retMsg: string }>("/v5/account/wallet-balance", { accountType: "UNIFIED" });
        return { ok: r.retCode === 0, message: r.retMsg };
      } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
    },

    async getBalances(): Promise<Balance[]> {
      if (!hasKeys) return [];
      const r = await signedGet<{ result: { list: Array<{
        totalAvailableBalance?: string;
        totalWalletBalance?: string;
        coin: Array<{ coin: string; walletBalance?: string; availableToWithdraw?: string; equity?: string; usdValue?: string }>;
      }> } }>(
        "/v5/account/wallet-balance", { accountType: "UNIFIED" },
      );
      const account = r.result?.list?.[0];
      const coins = account?.coin ?? [];
      const balances = coins.map(c => ({
        currency: c.coin,
        total: Number(c.walletBalance || c.equity || 0),
        available: Number(c.availableToWithdraw || c.walletBalance || c.equity || 0),
      })).filter(b => b.total > 0 || b.available > 0);
      const availableUsd = Number(account?.totalAvailableBalance || 0);
      const walletUsd = Number(account?.totalWalletBalance || availableUsd || 0);
      const usdish = balances.find(b => b.currency === "USDT" || b.currency === "USD" || b.currency === "USDC");
      if (availableUsd > 0 && usdish) {
        usdish.available = Math.max(usdish.available, availableUsd);
        usdish.total = Math.max(usdish.total, walletUsd, availableUsd);
      } else if (availableUsd > 0 || walletUsd > 0) {
        balances.push({ currency: "USDT", total: Math.max(walletUsd, availableUsd), available: availableUsd });
      }
      return balances;
    },

    async getQuote(symbol: string): Promise<Quote> {
      const s = toBybit(symbol);
      const r = await publicGet<{ result: { list: Array<{ symbol: string; bid1Price: string; ask1Price: string; lastPrice: string }> } }>(
        "/v5/market/tickers", { category: "spot", symbol: s },
      );
      const t = r.result?.list?.[0];
      if (!t) throw new Error(`No ticker for ${s}`);
      const bid = Number(t.bid1Price), ask = Number(t.ask1Price);
      return { symbol, bid, ask, mid: (bid + ask) / 2 || Number(t.lastPrice), ts: Date.now() };
    },

    async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
      const started = Date.now();
      const body: Record<string, unknown> = {
        category: "spot", symbol: toBybit(input.symbol),
        side: input.side === "buy" ? "Buy" : "Sell",
        orderType: input.orderType === "market" ? "Market" : "Limit",
        qty: String(input.qty),
        ...(input.limitPrice ? { price: String(input.limitPrice) } : {}),
        ...(input.clientOrderId ? { orderLinkId: input.clientOrderId } : {}),
      };
      const r = await signedPost<{ retCode: number; retMsg: string; result: { orderId: string; orderLinkId: string } }>(
        "/v5/order/create", body,
      );
      if (r.retCode !== 0) throw new Error(`Bybit rejected: ${r.retMsg}`);
      return {
        externalOrderId: r.result.orderId, clientOrderId: r.result.orderLinkId,
        status: "working", fees: 0, slippageBps: 0, latencyMs: Date.now() - started,
      };
    },

    async cancelOrder(externalOrderId: string, symbol?: string) {
      if (!symbol) return { ok: false };
      const r = await signedPost<{ retCode: number }>("/v5/order/cancel", {
        category: "spot", symbol: toBybit(symbol), orderId: externalOrderId,
      });
      return { ok: r.retCode === 0 };
    },

    async getPositions(): Promise<ConnectorPosition[]> {
      if (!hasKeys) return [];
      // Spot positions in Bybit v5 are represented as coin balances; perp positions are here.
      try {
        const r = await signedGet<{ result: { list: Array<{ symbol: string; size: string; avgPrice: string }> } }>(
          "/v5/position/list", { category: "linear", settleCoin: "USDT" },
        );
        return (r.result?.list ?? []).filter(p => Number(p.size) !== 0).map(p => ({
          symbol: p.symbol, qty: Number(p.size), avgEntry: Number(p.avgPrice),
        }));
      } catch { return []; }
    },

    async getHistory(limit = 50): Promise<HistoryEntry[]> {
      if (!hasKeys) return [];
      const r = await signedGet<{ result: { list: Array<{ orderId: string; symbol: string; side: string; execQty: string; execPrice: string; execFee: string; execTime: string }> } }>(
        "/v5/execution/list", { category: "spot", limit: String(limit) },
      );
      return (r.result?.list ?? []).map(x => ({
        externalOrderId: x.orderId, symbol: x.symbol,
        side: x.side.toLowerCase() === "buy" ? "buy" : "sell",
        qty: Number(x.execQty), price: Number(x.execPrice),
        fees: Number(x.execFee), ts: Number(x.execTime),
      }));
    },

    async checkHealth(): Promise<ConnectionHealth> {
      const t0 = Date.now();
      try {
        const r = await publicGet<{ time: number }>("/v5/market/time");
        const latency = Date.now() - t0;
        const skew = r.time ? r.time - Date.now() : null;
        return { ok: true, pingLatencyMs: latency, clockSkewMs: skew };
      } catch (e) {
        return { ok: false, pingLatencyMs: null, clockSkewMs: null, message: e instanceof Error ? e.message : String(e) };
      }
    },

    async getApiPermissions(): Promise<ApiPermissionSnapshot> {
      if (!hasKeys) return { enableReading: false, enableSpotAndMarginTrading: false, enableWithdrawals: false };
      try {
        const r = await signedGet<{ result: { permissions: Record<string, string[]>; ips: string[] } }>("/v5/user/query-api");
        const perms = r.result?.permissions ?? {};
        const flat = new Set(Object.values(perms).flat());
        return {
          ipRestrict: (r.result?.ips ?? []).length > 0,
          enableReading: true,
          enableSpotAndMarginTrading: flat.has("SpotTrade") || flat.has("ContractTrade"),
          enableWithdrawals: flat.has("Withdraw"),
          raw: r.result,
        };
      } catch (e) {
        throw new Error(`Bybit permission check failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}
