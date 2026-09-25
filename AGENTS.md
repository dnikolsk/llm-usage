# Repository guidance

Keep provider-specific UI and authentication code inside `collector/src/providers/<provider>`.
Never persist provider credentials or HTML in the service. Timestamps stay UTC in the API.
Add tests when modifying reset semantics, routing decisions, or the public `/v1` contract.
Use feature branches and small commits; keep secrets and browser profiles out of Git.
