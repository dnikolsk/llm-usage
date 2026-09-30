-- Align Cursor/ChatGPT account model_classes so GET model_class filters and
-- route_task model maps match collector bucket scopes.
--
-- Cursor collector emits scopes cursor_models + other_models.
-- ChatGPT/OpenAI collector emits scope work_codex (Work/Codex allowance).
-- Claude stays high_reasoning; Google AI Pro stays gemini_apps.
--
-- Review the target database and account IDs before applying. From the repository
-- root, with the target DATABASE_URL exported:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/scripts/align-route-classes.sql
-- With a linked Vercel project, expand DATABASE_URL inside the environment runner:
--   vercel env run -e production -- sh -c \
--     'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/scripts/align-route-classes.sql'
--
-- Note: `pnpm --filter @llm-usage/db provision` only inserts and refuses
-- conflicting updates — use this SQL (or a manual UPDATE) for existing rows.

BEGIN;

UPDATE accounts
SET model_classes = '["cursor_models","other_models"]'::jsonb,
    updated_at = now()
WHERE id = 'cursor-personal'
  AND model_classes IS DISTINCT FROM '["cursor_models","other_models"]'::jsonb;

UPDATE accounts
SET model_classes = '["work_codex"]'::jsonb,
    updated_at = now()
WHERE id = 'chatgpt-personal'
  AND model_classes IS DISTINCT FROM '["work_codex"]'::jsonb;

-- Expected after apply:
SELECT id, provider, model_classes, updated_at
FROM accounts
WHERE id IN (
  'claude-personal',
  'cursor-personal',
  'chatgpt-personal',
  'google-ai-pro-personal'
)
ORDER BY id;

COMMIT;
