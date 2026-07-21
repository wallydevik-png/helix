create table if not exists public.market_intel (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  provider text not null,
  kind text not null,
  score numeric not null,
  confidence numeric not null default 0.5,
  payload jsonb not null default '{}'::jsonb,
  ts timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  unique (symbol, provider, kind, ts)
);
create index if not exists market_intel_symbol_ts_idx on public.market_intel(symbol, ts desc);
create index if not exists market_intel_provider_idx on public.market_intel(provider, symbol);

grant select on public.market_intel to authenticated;
grant all on public.market_intel to service_role;

alter table public.market_intel enable row level security;

create policy "intel readable by authenticated"
  on public.market_intel for select to authenticated using (true);