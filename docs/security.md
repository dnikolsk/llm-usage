# Security

## Trust model

This is a single-owner service. Since the cloud observer release, the web service **holds the owner's provider logins**: one OAuth grant per provider account, enrolled once from the password-protected `/connect` page. It uses them to read usage live and to issue short-lived access tokens to workers. The grants are inference-capable (provider scopes cannot be narrowed to usage-only), so a compromise of the service or its database plus `LLM_SESSION_KEY` is equivalent to a compromise of those subscriptions. Protect the deployment accordingly: private hosting, no public indexing, strong independent secrets, prompt rotation.

Mitigations in place:

- Grants are stored only as AES-256-GCM ciphertext (`provider_sessions.sealed`), bound to the account id as associated data. `LLM_SESSION_KEY` lives only in the web service's environment; the database alone yields nothing.
- No API returns a refresh token. Workers receive access tokens and their expiry through the authenticated worker channel (`/v1/execution/worker/credentials`), and only for accounts whose execution target they own. The credential files handed to CLIs deliberately omit refresh material, so a CLI cannot rotate the service's grant.
- The PKCE verifier and state for an enrollment in progress live in a sealed, ten-minute, `HttpOnly`, `SameSite=Strict` cookie scoped to `/connect`; they never enter the database or logs. Enrollment routes require the dashboard cookie and reject cross-site requests.
- Refresh happens only in the service, only when a token is within two minutes of expiry, and a rejected refresh marks the session `reconnect_required` without deleting it or inventing capacity.
- Each provider grant is separate and revocable at the provider; disconnecting in the dashboard deletes the stored grant but does not revoke it upstream.

## Service credentials

Role tokens are separate, at least 32 characters, compared in constant time: `READ_TOKEN` (status/route), `JOB_TOKEN` (MCP and job submission), `ADMIN_TOKEN` (registration and manual resolution), `WORKER_<ID>_TOKEN` (one per worker: health, leases, results, credential issuance), `DASHBOARD_PASSWORD` (dashboard cookie), `LLM_SESSION_KEY` (grant encryption). `WRITE_TOKEN` now authorizes only the local demo's simulated observations on `/v1/ingest`; any real pushed usage is refused with `410 ingest_retired`.

Never log request headers, tokens, cookies, HTML, raw provider responses or sealed values. MCP inherits job authorization; it cannot enroll providers, read grants or register accounts. Worker identity is checked before health updates, credential issuance, job heartbeats and completion. Coding tasks require deployment isolation in addition to credential-directory separation; see [execution.md](execution.md). No additional spending is automatically approved. A billing-ready flag must reflect verified provider allowance/overage settings, not just successful login.
