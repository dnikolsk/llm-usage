import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionId = process.argv[2];
if (!extensionId || !/^[a-p]{32}$/.test(extensionId))
  throw new Error('Usage: pnpm --filter @llm-usage/collector install-native-host <Chrome extension ID>');
const hostPath = resolve(fileURLToPath(new URL('../native-host.sh', import.meta.url)));
const manifestPath = resolve(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.llm_usage.collector.json');
await chmod(hostPath, 0o755);
await mkdir(dirname(manifestPath), { recursive: true, mode: 0o700 });
await writeFile(manifestPath, JSON.stringify({
  name: 'com.llm_usage.collector', description: 'Local LLM usage collector', path: hostPath,
  type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`]
}, null, 2) + '\n', { mode: 0o600 });
process.stdout.write('Installed local native messaging host for the specified extension ID.\n');
