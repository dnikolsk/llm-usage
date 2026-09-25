CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY, owner_id text NOT NULL DEFAULT 'personal', provider text NOT NULL,
  label text NOT NULL, plan text, account_type text NOT NULL DEFAULT 'personal',
  enabled boolean NOT NULL DEFAULT true, collector_type text NOT NULL DEFAULT 'local_collector',
  capabilities jsonb NOT NULL DEFAULT '[]', model_classes jsonb NOT NULL DEFAULT '[]', priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id text NOT NULL REFERENCES accounts(id),
  idempotency_key text NOT NULL UNIQUE, payload_hash text NOT NULL, observed_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL CHECK (status IN ('ok','partial','error')),
  raw_metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS snapshots_account_observed_idx ON usage_snapshots(account_id,observed_at);
CREATE TABLE IF NOT EXISTS usage_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_id uuid NOT NULL REFERENCES usage_snapshots(id),
  provider_bucket_id text NOT NULL, kind text NOT NULL, scope text NOT NULL, unit text NOT NULL,
  used real, limit_value real, remaining real, used_fraction real, remaining_fraction real,
  window_started_at timestamptz, reset_at timestamptz, source text NOT NULL, confidence text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}', UNIQUE(snapshot_id,provider_bucket_id)
);
CREATE TABLE IF NOT EXISTS routing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL, name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false, configuration_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_default_routing_policy_per_owner ON routing_policies(owner_id) WHERE is_default = true;
