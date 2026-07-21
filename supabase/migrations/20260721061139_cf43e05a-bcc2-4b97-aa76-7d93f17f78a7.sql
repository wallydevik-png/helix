create table if not exists public.system_heartbeats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  component text not null,
  status text not null default 'ok',
  latency_ms int,
  detail jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);
grant select, insert on public.system_heartbeats to authenticated;
grant all on public.system_heartbeats to service_role;
alter table public.system_heartbeats enable row level security;
create policy "hb_own_select" on public.system_heartbeats for select to authenticated using (auth.uid() = user_id);
create policy "hb_own_insert" on public.system_heartbeats for insert to authenticated with check (auth.uid() = user_id);
create index if not exists hb_user_time on public.system_heartbeats(user_id, observed_at desc);
create index if not exists hb_user_comp on public.system_heartbeats(user_id, component, observed_at desc);

create table if not exists public.system_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'normal',
  reason text,
  degraded_since timestamptz,
  last_watchdog_at timestamptz,
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.system_status to authenticated;
grant all on public.system_status to service_role;
alter table public.system_status enable row level security;
create policy "ss_own_select" on public.system_status for select to authenticated using (auth.uid() = user_id);
create policy "ss_own_insert" on public.system_status for insert to authenticated with check (auth.uid() = user_id);
create policy "ss_own_update" on public.system_status for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.state_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  captured_at timestamptz not null default now()
);
grant select, insert, delete on public.state_snapshots to authenticated;
grant all on public.state_snapshots to service_role;
alter table public.state_snapshots enable row level security;
create policy "snap_own_select" on public.state_snapshots for select to authenticated using (auth.uid() = user_id);
create policy "snap_own_insert" on public.state_snapshots for insert to authenticated with check (auth.uid() = user_id);
create policy "snap_own_delete" on public.state_snapshots for delete to authenticated using (auth.uid() = user_id);
create index if not exists snap_user_kind_time on public.state_snapshots(user_id, kind, captured_at desc);

create table if not exists public.recovery_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  severity text not null default 'info',
  message text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select, insert on public.recovery_events to authenticated;
grant all on public.recovery_events to service_role;
alter table public.recovery_events enable row level security;
create policy "rec_own_select" on public.recovery_events for select to authenticated using (auth.uid() = user_id);
create policy "rec_own_insert" on public.recovery_events for insert to authenticated with check (auth.uid() = user_id);
create index if not exists rec_user_time on public.recovery_events(user_id, created_at desc);