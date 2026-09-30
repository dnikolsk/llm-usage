#!/bin/zsh
set -eu
umask 077

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
agent_dir="$HOME/Library/LaunchAgents"
log_dir="$HOME/.llm-usage"
plist="$agent_dir/com.llm-usage.collector.plist"
mkdir -p "$agent_dir" "$log_dir"

COLLECTOR_SCRIPT="$repo_root/collector/scripts/sync-all.sh" PLIST_PATH="$plist" LOG_DIR="$log_dir" \
  /usr/bin/python3 - <<'PY'
import os
import plistlib

home = os.path.expanduser('~')
path = ':'.join([
    os.path.join(home, '.local', 'share', 'mise', 'shims'),
    os.path.join(home, '.mise', 'shims'),
    os.path.join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
])
config = {
    'Label': 'com.llm-usage.collector',
    'ProgramArguments': ['/bin/zsh', os.environ['COLLECTOR_SCRIPT']],
    'EnvironmentVariables': {
        'PATH': path,
        'LLM_USAGE_URL': os.environ.get('LLM_USAGE_URL') or 'https://llm-usage.vercel.app'
    },
    'RunAtLoad': True,
    'StartInterval': 300,
    'StandardOutPath': os.path.join(os.environ['LOG_DIR'], 'collector.log'),
    'StandardErrorPath': os.path.join(os.environ['LOG_DIR'], 'collector.err.log'),
}
with open(os.environ['PLIST_PATH'], 'wb') as output:
    plistlib.dump(config, output)
PY

domain="gui/$(id -u)"
/bin/launchctl bootout "$domain/com.llm-usage.collector" 2>/dev/null || true
/bin/launchctl bootstrap "$domain" "$plist"
print "Installed $plist; collectors run every 5 minutes while this user is logged in."
