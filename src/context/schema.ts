import { z } from "zod";

export const taskInputSchema = z
  .object({
    persona: z.enum(["demoa", "demob"]),
    topic: z.string().trim().min(1, "选题不能为空").max(240),
    contentGoal: z.enum(["跑量", "信任", "咨询", "转化"]).optional(),
    riskLevel: z
      .enum(["低风险", "严格避开升学", "有条件讨论"])
      .optional(),
    includeImageText: z.boolean().optional(),
    bodyLength: z.number().int().min(300).max(2000).optional(),
    testVariable: z.string().trim().min(1).max(160).optional(),
    additionalConstraints: z.string().trim().min(1).max(1200).optional(),
    loadExperimentRules: z.boolean().optional(),
  })
  .strict();

export const comparisonSchema = z
  .object({
    left: taskInputSchema,
    right: taskInputSchema,
  })
  .strict();

export type TaskInputPayload = z.infer<typeof taskInputSchema>;
