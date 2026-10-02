CREATE TABLE IF NOT EXISTS execution_targets (
  id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id),
  registration jsonb NOT NULL, health text NOT NULL DEFAULT 'needs_login',
  observed_at timestamptz, cooldown_until timestamptz
);
CREATE TABLE IF NOT EXISTS execution_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL, request jsonb NOT NULL, decision jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued', target_id text REFERENCES execution_targets(id),
  account_id text REFERENCES accounts(id), worker_id text, lease_token text,
  lease_until timestamptz, cancel_requested boolean NOT NULL DEFAULT false,
  result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS execution_account_lease ON execution_jobs(account_id)
  WHERE state IN ('running','needs_review');
CREATE INDEX IF NOT EXISTS execution_queue ON execution_jobs(created_at) WHERE state='queued';
