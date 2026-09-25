import { parseUsage } from './parse';

export const source = {
  accountId: 'claude-personal',
  matches(url: URL): boolean {
    return url.origin === 'https://claude.ai' &&
      (url.pathname === '/settings/usage' || url.hash.toLowerCase() === '#settings/usage');
  },
  parseUsage
};
