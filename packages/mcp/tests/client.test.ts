import { describe, expect, it } from "vitest";
import { ApiError, createHttpClient } from "../src/client";
import { DEFAULT_BASE_URL, MissingEnvError, resolveApiConfig } from "../src/env";

const TOKEN = "secret-read-token-abcdef0123456789";

type Call = { url: string; init: RequestInit };

function fakeFetch(handler: (url: URL, init: RequestInit) => Response) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return handler(new URL(String(input)), init);
  }) as typeof fetch;
  return { fetchImpl: fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];

describe("HTTP client", () => {
  it("sends the bearer token and passes status through", async () => {
    const status = { generated_at: "2026-09-26T00:00:00Z", accounts: [{ id: "claude-personal", buckets: [{ remaining_fraction: 0.4 }] }] };
    const { fetchImpl, calls } = fakeFetch(() => json(status));
    const client = createHttpClient({ baseUrl: "https://usage.example/", token: TOKEN, fetchImpl });

    expect(await client.status()).toEqual(status);
    expect(calls[0].url).toBe("https://usage.example/v1/status");
    expect(calls[0].init.method).toBeUndefined();
    expect(header(calls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("maps route to GET /v1/route with query params", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ recommended: { account_id: "cursor-personal" }, candidates: [] }));
    const client = createHttpClient({ baseUrl: "https://usage.example", token: TOKEN, fetchImpl });

    await client.route({ capability: "coding" });
    await client.route({ capability: "coding", model_class: "high_reasoning" });
    expect(new URL(calls[0].url).pathname).toBe("/v1/route");
    expect(new URL(calls[0].url).search).toBe("?capability=coding");
    expect(new URL(calls[1].url).searchParams.get("model_class")).toBe("high_reasoning");
  });

  it("maps routeTask to POST /v1/route with a JSON body", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ decision_source: "jev", handoff: null }));
    const client = createHttpClient({ baseUrl: "https://usage.example", token: TOKEN, fetchImpl });
    const request = {
      task: "Fix a typo in the README title",
      project: { stage: "ongoing" as const, current_account_id: "claude-personal", current_model: "claude-sonnet" },
      estimated_work: "quick" as const,
      needs_mac: false,
    };

    expect(await client.routeTask(request)).toEqual({ decision_source: "jev", handoff: null });
    expect(calls[0].init.method).toBe("POST");
    expect(new URL(calls[0].url).pathname).toBe("/v1/route");
    expect(header(calls[0], "content-type")).toBe("application/json");
    expect(header(calls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual(request);
  });

  it("throws ApiError with status on 401 and never echoes the token", async () => {
    // Even if a misbehaving server echoes the token, it is redacted.
    const { fetchImpl } = fakeFetch(() => json({ error: `unauthorized ${TOKEN}` }, 401));
    const client = createHttpClient({ baseUrl: "https://usage.example", token: TOKEN, fetchImpl });

    const err = await client.status().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).message).toContain("401");
    expect((err as ApiError).message).toContain("LLM_USAGE_READ_TOKEN");
    expect(JSON.stringify({ m: (err as ApiError).message, c: (err as ApiError).code, s: String(err) })).not.toContain(TOKEN);
  });

  it("surfaces 400/503 codes and network failures without the token", async () => {
    const { fetchImpl } = fakeFetch((url, init) =>
      init.method === "POST" ? json({ error: "jev_unavailable" }, 503) : json({ error: "invalid_filter" }, 400),
    );
    const client = createHttpClient({ baseUrl: "https://usage.example", token: TOKEN, fetchImpl });
    await expect(client.routeTask({ task: "A sufficiently long task" })).rejects.toMatchObject({ status: 503, code: "jev_unavailable" });
    await expect(client.route({ capability: "coding" })).rejects.toMatchObject({ status: 400, code: "invalid_filter" });

    const broken = createHttpClient({
      baseUrl: "https://usage.example",
      token: TOKEN,
      fetchImpl: (async () => {
        throw new TypeError(`fetch failed for Bearer ${TOKEN}`);
      }) as typeof fetch,
    });
    const err = (await broken.status().catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(0);
    expect(err.message).toContain("unreachable");
    expect(err.message).not.toContain(TOKEN);
  });
});

describe("env", () => {
  it("requires LLM_USAGE_READ_TOKEN", () => {
    expect(() => resolveApiConfig({})).toThrow(MissingEnvError);
    expect(() => resolveApiConfig({ LLM_USAGE_READ_TOKEN: "  " })).toThrow(/LLM_USAGE_READ_TOKEN/);
  });

  it("defaults the base URL to production and honours overrides", () => {
    expect(resolveApiConfig({ LLM_USAGE_READ_TOKEN: TOKEN })).toEqual({ baseUrl: DEFAULT_BASE_URL, token: TOKEN });
    expect(DEFAULT_BASE_URL).toBe("https://llm-usage.vercel.app");
    expect(resolveApiConfig({ LLM_USAGE_READ_TOKEN: TOKEN, LLM_USAGE_BASE_URL: "http://localhost:3000" }).baseUrl).toBe(
      "http://localhost:3000",
    );
  });
});
