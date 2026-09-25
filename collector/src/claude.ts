import * as browser from './providers/anthropic/browser';
import { runProvider } from './run-provider';

await runProvider('claude', 'anthropic', browser);
