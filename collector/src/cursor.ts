import * as browser from './providers/cursor/browser';
import { runProvider } from './run-provider';

await runProvider('cursor', 'cursor', browser);
