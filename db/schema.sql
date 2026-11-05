-- CovenantGo database schema (PostgreSQL — works as-is on Supabase / Neon / RDS).
-- Mirrors the shapes in /data/*.json and docs/API.md.

create extension if not exists "pgcrypto";

-- ---------- TikTok GO agencies (the 14 official agencies) ----------
create table agencies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  is_recruiter    boolean not null default false   -- our agency: receives opted-in independent creators
);

-- ---------- Creators ----------
create table users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,
  password_hash   text,                       -- null if using an auth provider (Supabase Auth, Auth0, Sign in with Apple)
  name            text not null,
  phone           text,                       -- optional
  agency_id       uuid references agencies(id), -- null = independent GO creator (no agency)
  recruit_interest boolean not null default false, -- independent creator opted in to hear from our agency
  recruit_status  text check (recruit_status in ('new','contacted','signed','declined')),
  country         char(2) not null,           -- ISO 3166-1 alpha-2 (US, MX, …)
  state           text not null,
  city            text not null,
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  role            text not null default 'creator' check (role in ('creator','partner_admin','admin')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table user_platforms (
  user_id         uuid not null references users(id) on delete cascade,
  platform        text not null check (platform in ('tiktok','instagram','snapchat','facebook','youtube','x')),
  handle          text not null,
  followers       integer not null default 0,
  verified        boolean not null default false,   -- set true once OAuth-connected to the platform
  external_id     text,                             -- platform account id after OAuth
  updated_at      timestamptz not null default now(),
  primary key (user_id, platform)
);

-- ---------- Hospitality partners ----------
create table partner_groups (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  website         text
);

create table partners (
  id              text primary key,                -- e.g. ptn_casa-marea-resort
  group_id        uuid references partner_groups(id),
  name            text not null,
  category        text not null check (category in ('Hotels & Resorts','Things to Do')),
  type            text not null,                   -- sub-type: Hotel, Resort, Boutique, Tour, Attraction, Adventure
  tiktok_go_listed boolean not null default false,
  tiktok_go_id    text unique,                     -- id from TikTok GO / affiliate feed when available
  country         char(2) not null,
  state           text not null,
  city            text not null,
  address         text,
  description     text,
  rating          numeric(2,1),
  accent_color    text,
  listing_tier    text not null default 'standard' check (listing_tier in ('standard','featured')),  -- featured = paid upsell: photos on list views
  featured_until  timestamptz,                     -- when the paid placement expires
  photos          text[] not null default '{}',
  source          text not null default 'manual',  -- manual | tiktok_go | channel_manager | ...
  synced_at       timestamptz
);
create index partners_location_idx on partners (country, state, city);

-- ---------- Content days ----------
create table content_days (
  id              text primary key,                -- e.g. cd_001
  partner_id      text not null references partners(id) on delete cascade,
  title           text not null,
  date            date not null,
  call_time       text,
  country         char(2) not null,
  state           text not null,
  city            text not null,
  platforms       text[] not null default '{tiktok}',
  spots_total     integer not null,
  min_followers   integer not null default 0,
  commission_rate numeric(4,1),                    -- percent paid via TikTok GO bookings
  activities      text[] not null default '{}',     -- "What you'll do": set per content day by the partnership
  custom_note     text,
  deliverables    text[] not null default '{}',
  status          text not null default 'open' check (status in ('draft','open','full','closed','cancelled')),
  created_at      timestamptz not null default now()
);
create index content_days_search_idx on content_days (country, state, city, date);

-- ---------- Applications (creator ↔ content day) ----------
create table applications (
  id              uuid primary key default gen_random_uuid(),
  content_day_id  text not null references content_days(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  note            text,
  status          text not null default 'pending' check (status in ('pending','approved','declined','waitlisted','completed')),
  applied_at      timestamptz not null default now(),
  decided_at      timestamptz,
  unique (content_day_id, user_id)
);

-- ---------- Footage Vault (clips shot by the Covenant team) ----------
create table vault_clips (
  id              text primary key,                -- e.g. clip_001
  partner_id      text not null references partners(id) on delete cascade,
  title           text not null,
  video_url       text,                            -- storage path / CDN url of the master file
  thumbnail_url   text,
  duration_sec    integer not null,
  orientation     text not null default '9:16',
  resolution      text,
  shot_on         date,
  shot_by         text not null default 'Covenant Creative team',
  country         char(2) not null,
  state           text not null,
  city            text not null,
  tags            text[] not null default '{}',
  usage_terms     text not null,
  created_at      timestamptz not null default now()
);
create index vault_clips_search_idx on vault_clips (country, state, city);

create table saved_clips (
  user_id         uuid not null references users(id) on delete cascade,
  clip_id         text not null references vault_clips(id) on delete cascade,
  saved_at        timestamptz not null default now(),
  downloaded_at   timestamptz,
  primary key (user_id, clip_id)
);

-- ---------- Sponsored ads (paid placements, e.g. carousel under the header) ----------
create table ads (
  id              text primary key,
  placement       text not null default 'top',
  partner_id      text references partners(id) on delete cascade,  -- null for house ads
  headline        text not null,
  body            text,
  cta             text,
  href            text,                            -- in-app link, e.g. #/day/cd_002
  image_url       text,
  is_house        boolean not null default false,  -- 'ad space available' promo
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz,
  priority        integer not null default 0
);

-- ---------- Rewards (gamification) ----------
create table reward_programs (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,                   -- e.g. "Win a creator trip for two"
  prize_detail    text,
  content_days_goal integer not null,              -- attend this many content days, OR
  post_links_goal integer not null,                -- submit this many approved post links
  starts_at       timestamptz not null,
  ends_at         timestamptz not null
);

create table post_links (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  url             text not null,
  source          text not null check (source in ('vault','content_day','other')),
  clip_id         text references vault_clips(id),
  content_day_id  text references content_days(id),
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_at    timestamptz not null default now(),
  unique (user_id, url)
);
-- Content days count toward rewards when applications.status = 'completed' (partner check-in).

-- spots_taken is derived, never stored
create view content_days_with_spots as
select cd.*,
       coalesce(count(a.*) filter (where a.status = 'approved'), 0)::int as spots_taken
from content_days cd
left join applications a on a.content_day_id = cd.id
group by cd.id;
