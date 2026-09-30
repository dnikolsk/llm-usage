INSERT INTO accounts(id,provider,label,plan,account_type,capabilities,model_classes) VALUES
('claude-personal','anthropic','Claude Personal','Pro','personal','["coding","chat"]','["high_reasoning"]'),
('claude-work','anthropic','Claude Work','Team','work','["coding","chat"]','["high_reasoning"]'),
('cursor-personal','cursor','Cursor Personal','Pro','personal','["coding"]','["cursor_models","other_models"]'),
('chatgpt-personal','openai','ChatGPT Personal','Plus','personal','["coding","chat"]','["work_codex"]'),
('google-ai-pro-personal','google','Google AI Pro','AI Pro','personal','["coding","chat"]','["gemini_apps"]')
ON CONFLICT(id) DO NOTHING;
