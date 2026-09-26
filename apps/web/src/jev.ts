import { z } from 'zod';
import type { TaskJudgment, TaskRouteRequest } from '@llm-usage/core';

const score = z.object({ type: z.literal('score'), score: z.number().finite(),
  confidence: z.number().min(0).max(1) }).passthrough();
const noul = z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) }).passthrough();
const responseSchema = z.object({
  model: z.string().min(1),
  answers: z.object({ difficulty: score, work_size: score, interactive: noul, needs_mac: noul })
}).passthrough();

export class JevUnavailable extends Error {}

export async function evaluateTask(request: TaskRouteRequest): Promise<TaskJudgment> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new JevUnavailable('Jev API key is not configured');
  const body = {
    model: 'jev-latest',
    state: { task: request.task, project_stage: request.project?.stage ?? 'unknown' },
    questions: {
      difficulty: { type: 'score', instructions: 'How much reasoning and coding ability does `task` require?',
        criteria: ['Routine editing or lookup', 'Ordinary implementation', 'Complex architecture or debugging', 'Exceptional reasoning or high-stakes work'] },
      work_size: { type: 'score', instructions: 'How much work is described by `task`?',
        criteria: ['One short, finishable task', 'Several steps or moderate iteration', 'Large project or long autonomous job'] },
      interactive: { type: 'noul', instructions: 'Will `task` likely need frequent user steering or back-and-forth while work is in progress?' },
      needs_mac: { type: 'noul', instructions: 'Does `task` require files, installed tools, credentials, or connected devices on the user’s Mac?' }
    }
  };
  let response: Response;
  try {
    response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', signal: AbortSignal.timeout(8_000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch { throw new JevUnavailable('Jev request failed'); }
  if (!response.ok) throw new JevUnavailable(`Jev returned HTTP ${response.status}`);
  let parsed: z.infer<typeof responseSchema>;
  try { parsed = responseSchema.parse(await response.json()); }
  catch { throw new JevUnavailable('Jev returned an invalid decision'); }
  const { difficulty, work_size, interactive, needs_mac } = parsed.answers;
  if (difficulty.score < 0 || difficulty.score > 3 || work_size.score < 0 || work_size.score > 2)
    throw new JevUnavailable('Jev scores were out of range');
  return { difficulty: difficulty.score, workSize: work_size.score, interactive: interactive.noul,
    needsMac: needs_mac.noul, model: parsed.model,
    confidence: Math.min(difficulty.confidence, work_size.confidence) };
}
