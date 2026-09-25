#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -x /opt/homebrew/bin/node ]; then
  exec /opt/homebrew/bin/node --import tsx src/native-host.ts
fi
exec node --import tsx src/native-host.ts
