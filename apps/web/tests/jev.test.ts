import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateTask, JevUnavailable } from '../src/jev';

const key = 'private-test-key';
beforeEach(() => { process.env.TYPESAFE_API_KEY = key; });
afterEach(() => { delete process.env.TYPESAFE_API_KEY; vi.unstubAllGlobals(); });

describe('Jev decision client', () => {
  it('sends focused typed questions and parses the official response shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ model: 'jev-1.13.0', answers: {
      difficulty: { type: 'score', score: 1.2, confidence: 0.8 },
      work_size: { type: 'score', score: 1.8, confidence: 0.7 },
      interactive: { type: 'noul', noul: 0.4 }, needs_mac: { type: 'noul', noul: 0.2 }
    } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await evaluateTask({ task: 'Implement a dashboard routing endpoint', capability: 'coding' });
    expect(result).toMatchObject({difficulty:1.2,workSize:1.8,interactive:.4,needsMac:.2,confidence:.7});
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(options.headers.Authorization).toBe(`Bearer ${key}`);
    const body = JSON.parse(options.body);
    expect(Object.keys(body.questions)).toEqual(['difficulty','work_size','interactive','needs_mac']);
    expect(JSON.stringify(body)).not.toContain(key);
  });

  it('rejects unconfigured and malformed decisions', async () => {
    delete process.env.TYPESAFE_API_KEY;
    await expect(evaluateTask({task:'Implement a dashboard routing endpoint',capability:'coding'})).rejects.toBeInstanceOf(JevUnavailable);
    process.env.TYPESAFE_API_KEY = key;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ answers: { difficulty: 2 } })));
    await expect(evaluateTask({task:'Implement a dashboard routing endpoint',capability:'coding'})).rejects.toBeInstanceOf(JevUnavailable);
  });
});
