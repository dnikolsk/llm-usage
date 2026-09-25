import { parseUsage } from './parse';

export const source = {
  accountId: 'chatgpt-personal',
  matches(url: URL): boolean {
    return url.origin === 'https://chatgpt.com' &&
      (url.hash.toLowerCase() === '#settings/usage' || url.pathname === '/codex/settings/usage');
  },
  parseUsage
};
