-- Provider logins held by the service, encrypted with LLM_SESSION_KEY (AES-256-GCM); the key never enters the database.
CREATE TABLE IF NOT EXISTS provider_sessions (
  account_id text PRIMARY KEY REFERENCES accounts(id),
  provider text NOT NULL,
  sealed text NOT NULL,
  expires_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  refreshed_at timestamptz,
  status text NOT NULL DEFAULT 'connected',
  failure_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
