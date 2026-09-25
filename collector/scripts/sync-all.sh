#!/bin/zsh
set -u

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export LLM_USAGE_URL="https://llm-usage.vercel.app"

repo_root="$(cd "$(dirname "$0")/../.." && pwd)" || exit 1
cd "$repo_root" || exit 1

tsx="$repo_root/collector/node_modules/.bin/tsx"
if [[ ! -x "$tsx" ]]; then
  print -u2 'Collector dependencies are missing; run pnpm install in the repository.'
  exit 1
fi

result=0
for provider in claude openai cursor; do
  "$tsx" "$repo_root/collector/src/$provider-cli.ts" sync || result=1
done
exit "$result"
