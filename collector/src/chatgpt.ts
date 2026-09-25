import * as browser from './providers/openai/browser';
import { runProvider } from './run-provider';

await runProvider('chatgpt', 'openai', browser);
