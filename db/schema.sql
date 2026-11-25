-- Kobolt schema. Applied on every boot; every statement is idempotent.

CREATE TABLE IF NOT EXISTS users (
  app_user_id   text PRIMARY KEY,
  username      text,
  name          text NOT NULL,
  avatar        text,
  currency      text NOT NULL DEFAULT 'NGN',
  time_zone     text,
  tiktok_handle text,
  show_earnings boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_username ON users (lower(username));

CREATE TABLE IF NOT EXISTS deals (
  id                  text PRIMARY KEY,
  interaction_id      text UNIQUE NOT NULL,
  brand_id            text NOT NULL REFERENCES users(app_user_id),
  creator_id          text NOT NULL REFERENCES users(app_user_id),
  brand_name          text NOT NULL,
  title               text NOT NULL,
  platform            text NOT NULL,
  post_count          int NOT NULL,
  price_ngn           int,
  price_usd_micro     bigint,
  hashtags            text[] NOT NULL DEFAULT '{}',
  disclosure          text NOT NULL DEFAULT '#ad',
  avoid_names         text[] NOT NULL DEFAULT '{}',
  avoid_claims        text[] NOT NULL DEFAULT '{}',
  accept_secs         int NOT NULL,
  hold_result         boolean NOT NULL DEFAULT false,
  posts_due_at        timestamptz NOT NULL,
  state               text NOT NULL DEFAULT 'new',
  interaction_version int NOT NULL DEFAULT 0,
  prize_id            text UNIQUE,
  pot_usd_micro       bigint,
  pot_ngn             numeric,
  per_post_usd_micro  bigint,
  funded_at           timestamptz,
  accept_deadline     timestamptz,
  accepted_at         timestamptz,
  result_deadline     timestamptz,
  result_sent_at      timestamptz,
  result_earned       int,
  paid_amount_micro   bigint,
  dispute_ends_at     timestamptz,
  closed_at           timestamptz,
  close_reason        text,
  card_posted         boolean NOT NULL DEFAULT false,
  feed_posted         boolean NOT NULL DEFAULT false,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deals_brand ON deals (brand_id);
CREATE INDEX IF NOT EXISTS deals_creator ON deals (creator_id);
CREATE INDEX IF NOT EXISTS deals_state ON deals (state);

CREATE TABLE IF NOT EXISTS posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         text NOT NULL REFERENCES deals(id),
  slot            int NOT NULL,
  url             text NOT NULL,
  canonical_url   text NOT NULL,
  caption         text NOT NULL DEFAULT '',
  author          text,
  posted_at       timestamptz,
  live            boolean,
  source          text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  checks          jsonb NOT NULL DEFAULT '[]',
  brand_decide_by timestamptz,
  replaced        boolean NOT NULL DEFAULT false,
  checked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS posts_deal_url ON posts (deal_id, canonical_url) WHERE NOT replaced;
CREATE UNIQUE INDEX IF NOT EXISTS posts_no_reuse ON posts (canonical_url) WHERE status IN ('passed', 'brand_ok') AND NOT replaced;
CREATE INDEX IF NOT EXISTS posts_deal ON posts (deal_id);

CREATE TABLE IF NOT EXISTS events (
  id         bigserial PRIMARY KEY,
  deal_id    text,
  type       text NOT NULL,
  actor      text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_deal ON events (deal_id, id);

CREATE TABLE IF NOT EXISTS zend_events (
  event_id    text PRIMARY KEY,
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_outbox (
  id          text PRIMARY KEY,
  to_username text NOT NULL,
  text        text NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  next_at     timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_outbox_pending ON bot_outbox (next_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS bot_state (
  k text PRIMARY KEY,
  v text NOT NULL
);
