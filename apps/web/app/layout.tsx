import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'LLM Usage Dashboard', description: 'Private personal subscription usage dashboard', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
