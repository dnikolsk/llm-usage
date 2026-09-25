import { parseUsage } from './parse';

export const source = {
  accountId: 'cursor-personal',
  matches(url: URL): boolean {
    return url.origin === 'https://cursor.com' && url.pathname === '/dashboard/spending';
  },
  parseUsage
};
