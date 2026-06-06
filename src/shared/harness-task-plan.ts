import { z } from 'zod';

export const harnessTaskPlanPhaseSchema = z.enum([
  'chat',
  'ready_to_task',
  'task_plan',
  'executing_task'
]);

export const harnessTaskPlanStepStatusSchema = z.enum([
  'pending',
  'active',
  'completed',
  'failed',
  'blocked'
]);

export const harnessTaskPlanStepSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  status: harnessTaskPlanStepStatusSchema.default('pending'),
  detail: z.string().trim().min(1).max(1000).nullable().default(null)
});

export const harnessTaskPlanSchema = z.object({
  phase: harnessTaskPlanPhaseSchema,
  objective: z.string().trim().min(1).max(2000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
  steps: z.array(harnessTaskPlanStepSchema).min(1).max(20)
});

export type HarnessTaskPlanPhase = z.infer<typeof harnessTaskPlanPhaseSchema>;
export type HarnessTaskPlanStepStatus = z.infer<typeof harnessTaskPlanStepStatusSchema>;
export type HarnessTaskPlanStep = z.infer<typeof harnessTaskPlanStepSchema>;
export type HarnessTaskPlan = z.infer<typeof harnessTaskPlanSchema>;

export function parseHarnessTaskPlan(value: unknown): HarnessTaskPlan | null {
  const result = harnessTaskPlanSchema.safeParse(value);
  return result.success ? result.data : null;
}
