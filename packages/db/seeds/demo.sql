INSERT INTO accounts(id,provider,label,plan,account_type,capabilities,model_classes) VALUES
('claude-personal','anthropic','Claude Personal','Pro','personal','["coding","chat"]','["high_reasoning"]'),
('claude-work','anthropic','Claude Work','Team','work','["coding","chat"]','["high_reasoning"]')
ON CONFLICT(id) DO NOTHING;
