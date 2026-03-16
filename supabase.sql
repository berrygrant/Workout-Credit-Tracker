create extension if not exists pgcrypto;

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  entry_type text not null check (entry_type in ('purchase', 'use')),
  credits integer not null check (credits > 0),
  note text not null default '',
  created_at timestamptz not null default timezone('utc'::text, now()),
  created_by uuid not null default auth.uid() references auth.users(id)
);

create index if not exists ledger_entries_event_date_idx
  on public.ledger_entries (event_date, created_at, id);

alter table public.ledger_entries enable row level security;

drop policy if exists "ledger_entries_select_public" on public.ledger_entries;
drop policy if exists "ledger_entries_select_authenticated" on public.ledger_entries;
create policy "ledger_entries_select_public"
  on public.ledger_entries
  for select
  to anon, authenticated
  using (true);

drop policy if exists "ledger_entries_insert_authenticated" on public.ledger_entries;
create policy "ledger_entries_insert_authenticated"
  on public.ledger_entries
  for insert
  to authenticated
  with check (created_by = auth.uid());

drop policy if exists "ledger_entries_delete_authenticated" on public.ledger_entries;
create policy "ledger_entries_delete_authenticated"
  on public.ledger_entries
  for delete
  to authenticated
  using (created_by = auth.uid());

create or replace function public.ledger_balance_stays_nonnegative(
  action_name text,
  row_id uuid default null,
  row_event_date date default null,
  row_entry_type text default null,
  row_credits integer default null,
  row_created_at timestamptz default now()
)
returns boolean
language sql
stable
set search_path = public
as $$
  with candidate_entries as (
    select id, event_date, entry_type, credits, created_at
    from public.ledger_entries
    where action_name <> 'delete' or id <> row_id

    union all

    select row_id, row_event_date, row_entry_type, row_credits, row_created_at
    where action_name = 'insert'
  ),
  balances as (
    select
      sum(
        case
          when entry_type = 'purchase' then credits
          else -credits
        end
      ) over (order by event_date, created_at, id) as balance_after
    from candidate_entries
  )
  select coalesce(min(balance_after), 0) >= 0
  from balances;
$$;

create or replace function public.prevent_negative_tracker_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not public.ledger_balance_stays_nonnegative(
      'insert',
      new.id,
      new.event_date,
      new.entry_type,
      new.credits,
      new.created_at
    ) then
      raise exception 'This change would make the balance go negative.';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if not public.ledger_balance_stays_nonnegative('delete', old.id) then
      raise exception 'Delete later usage first so the balance never goes negative.';
    end if;

    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists ledger_entries_balance_guard on public.ledger_entries;
create trigger ledger_entries_balance_guard
  before insert or delete on public.ledger_entries
  for each row
  execute function public.prevent_negative_tracker_balance();
