/** Thin HTTP client for the deployed llm-usage /v1 API. Read-only: no ingest or write calls. */

export type ProjectStage = "new" | "ongoing";
export type EstimatedWork = "quick" | "medium" | "large";
export type InteractionLevel = "low" | "high";

export interface RouteQuery {
  capability: string;
  model_class?: string;
}

/** Mirrors openapi TaskRouteRequest. */
export interface TaskRouteRequest {
  task: string;
  project?: { stage: ProjectStage; current_account_id?: string; current_model?: string };
  estimated_work?: EstimatedWork;
  interaction_level?: InteractionLevel;
  needs_mac?: boolean;
  repo_pushed?: boolean;
  capability?: string;
}

/** Responses are passed through untouched so agents see the full API contract. */
export type ApiResponse = Record<string, unknown>;

export interface LlmUsageClient {
  status(): Promise<ApiResponse>;
  route(query: RouteQuery): Promise<ApiResponse>;
  routeTask(request: TaskRouteRequest): Promise<ApiResponse>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface HttpClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

const HINTS: Record<number, string> = {
  400: "request rejected by the API",
  401: "check LLM_USAGE_READ_TOKEN (read token required)",
  503: "usage storage or Jev is unavailable",
};

export function createHttpClient({ baseUrl, token, fetchImpl = fetch }: HttpClientOptions): LlmUsageClient {
  const root = baseUrl.replace(/\/+$/, "");
  const redact = (text: string) => (token ? text.split(token).join("[redacted]") : text);

  async function call(path: string, init: RequestInit = {}): Promise<ApiResponse> {
    let res: Response;
    try {
      res = await fetchImpl(`${root}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ApiError(0, redact(`llm-usage API unreachable at ${root}: ${reason}`));
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const code = typeof (body as { error?: unknown } | null)?.error === "string" ? (body as { error: string }).error : undefined;
      const hint = HINTS[res.status];
      const message = `llm-usage API ${init.method ?? "GET"} ${path.split("?")[0]} failed with HTTP ${res.status}` +
        (code ? ` (${code})` : "") + (hint ? `: ${hint}` : "");
      throw new ApiError(res.status, redact(message), code && redact(code));
    }
    if (!body || typeof body !== "object") {
      throw new ApiError(res.status, `llm-usage API returned a non-JSON body for ${path.split("?")[0]}`);
    }
    return body as ApiResponse;
  }

  return {
    status: () => call("/v1/status"),
    route({ capability, model_class }) {
      const params = new URLSearchParams({ capability });
      if (model_class) params.set("model_class", model_class);
      return call(`/v1/route?${params}`);
    },
    routeTask: (request) => call("/v1/route", { method: "POST", body: JSON.stringify(request) }),
  };
}
