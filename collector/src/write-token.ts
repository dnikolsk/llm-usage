import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const keychainService = 'llm-usage-write-token';
export const keychainAccount = 'llm-usage';

export async function loadWriteToken(
  envToken = process.env.LLM_USAGE_WRITE_TOKEN,
  platform = process.platform,
  readKeychain: () => Promise<string> = async () => {
    const { stdout } = await execFileAsync('/usr/bin/security', [
      'find-generic-password', '-s', keychainService, '-a', keychainAccount, '-w'
    ], { encoding: 'utf8', maxBuffer: 4096 });
    return stdout.trimEnd();
  }
): Promise<string> {
  let token = envToken;
  if (!token) {
    if (platform !== 'darwin') throw new Error('Set LLM_USAGE_WRITE_TOKEN on this platform');
    try { token = await readKeychain(); }
    catch { throw new Error(`Store the write token in macOS Keychain as service ${keychainService}, account ${keychainAccount}`); }
  }
  if (token.length < 32) throw new Error('Write token must be at least 32 characters');
  return token;
}
