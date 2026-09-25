# Security

Write and read bearer tokens are separate. The write credential only accesses ingestion, while the read credential only accesses status and routing. Compare token digests in constant time. Never log request headers, tokens, browser sessions, HTML, or raw provider responses. Collector browser profiles and secrets remain on the Mac. Treat this first version as a single-owner service; protect deployments from public indexing and rotate leaked tokens. Migration and account provisioning require database access, not either API token.
