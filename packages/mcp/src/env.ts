export const DEFAULT_BASE_URL = "https://llm-usage.vercel.app";

export interface ApiConfig {
  baseUrl: string;
  token: string;
}

export class MissingEnvError extends Error {
  constructor(public readonly variable: string) {
    super(`llm-usage-mcp: missing required env var ${variable}`);
  }
}

/** Pure config resolution; throws MissingEnvError instead of exiting so it is testable. */
export function resolveApiConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const token = env.LLM_USAGE_READ_TOKEN?.trim();
  if (!token) throw new MissingEnvError("LLM_USAGE_READ_TOKEN");
  const baseUrl = env.LLM_USAGE_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return { baseUrl, token };
}

/** For the stdio entrypoint: print a clear message and exit 1 when the read token is missing. */
export function apiConfigFromEnv(): ApiConfig {
  try {
    return resolveApiConfig();
  } catch (err) {
    if (err instanceof MissingEnvError) {
      console.error(`${err.message} (the llm-usage READ_TOKEN; see packages/mcp/README.md)`);
      process.exit(1);
    }
    throw err;
  }
}
