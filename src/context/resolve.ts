import type {
  ResolvedTaskConfig,
  RuleConflict,
  TaskInput,
} from "./types";

const personaLabel = {
  demoa: "示例甲",
  demob: "示例乙",
} as const;

export function resolveTaskConfig(input: TaskInput): {
  config: ResolvedTaskConfig;
  conflicts: RuleConflict[];
} {
  const personaAgent =
    input.persona === "demoa"
      ? "agents/示例甲生产agent.md"
      : "agents/示例乙生产agent.md";
  const personaRule =
    input.persona === "demoa"
      ? "01_示例甲账号人设与内容规则.md"
      : "02_示例乙账号人设与内容规则.md";

  const suggestedGoal = input.persona === "demoa" ? "咨询" : "信任";
  const contentGoal = input.contentGoal
    ? {
        value: input.contentGoal,
        source: "explicit" as const,
        status: "confirmed" as const,
        editable: true,
        rationale: "用户在本次任务中明确指定。",
      }
    : {
        value: suggestedGoal as "咨询" | "信任",
        source: "inferred" as const,
        sourcePath: personaAgent,
        status: "suggested" as const,
        editable: true,
        rationale:
          input.persona === "demoa"
            ? "示例甲 Agent 默认偏咨询；这是建议值，尚未获得用户确认。"
            : "示例乙 Agent 给出“跑量/信任”两个默认方向；系统保守建议“信任”，仍待用户确认。",
      };

  const includeImageText =
    input.includeImageText !== undefined
      ? {
          value: input.includeImageText,
          source: "explicit" as const,
          status: "confirmed" as const,
          editable: true,
          rationale: "用户本次明确值覆盖普通格式默认值。",
        }
      : {
          value: true,
          source: "persona-default" as const,
          sourcePath: personaAgent,
          status: "confirmed" as const,
          editable: true,
          rationale: `${personaLabel[input.persona]} Agent 的账号默认值优先于总控 Skill 的普通默认值。`,
        };

  const config: ResolvedTaskConfig = {
    persona: {
      value: input.persona,
      source: "explicit",
      status: "confirmed",
      editable: true,
      rationale: "账号由用户明确选择。",
    },
    topic: {
      value: input.topic,
      source: "explicit",
      status: "confirmed",
      editable: true,
      rationale: "选题由用户明确输入。",
    },
    contentGoal,
    riskLevel: input.riskLevel
      ? {
          value: input.riskLevel,
          source: "explicit",
          status: "confirmed",
          editable: true,
          rationale: "用户本次明确指定风险级别；系统安全底线仍不可覆盖。",
        }
      : {
          value: "低风险",
          source: "global-default",
          sourcePath: "skills/xhs-content-controller/SKILL.md",
          status: "confirmed",
          editable: true,
          rationale: "总控 Skill 在缺失风险要求时采用低风险默认值。",
        },
    includeImageText,
    bodyLength: input.bodyLength
      ? {
          value: input.bodyLength,
          source: "explicit",
          status: "confirmed",
          editable: true,
          rationale: "用户本次明确指定正文长度。",
        }
      : {
          value: 850,
          source: "persona-default",
          sourcePath: personaAgent,
          status: "confirmed",
          editable: true,
          rationale: "总控 Skill 与账号 Agent 对 850 字默认值一致，合并为一个生效限制。",
        },
    testVariable: {
      value: input.testVariable ?? null,
      source: input.testVariable ? "explicit" : "global-default",
      status: "confirmed",
      editable: true,
      rationale: input.testVariable
        ? "测试变量由用户明确输入。"
        : "当前任务未提供测试变量，不会虚构。",
    },
    additionalConstraints: {
      value: input.additionalConstraints ?? null,
      source: input.additionalConstraints ? "explicit" : "global-default",
      status: "confirmed",
      editable: true,
      rationale: input.additionalConstraints
        ? "补充约束由用户明确输入，但不能覆盖安全与事实约束。"
        : "当前任务没有额外约束。",
    },
  };

  const conflicts: RuleConflict[] = [
    {
      id: "image-text-default",
      title: "未指定时是否生成配图文字",
      kind: "default",
      status: "resolved",
      sources: [
        {
          path: "skills/xhs-content-controller/SKILL.md",
          claim: "未请求配图文字时省略。",
        },
        {
          path: personaAgent,
          claim: "缺失时默认输出配图文字。",
        },
      ],
      resolution:
        input.includeImageText !== undefined
          ? "本次显式输入优先于两个普通默认值。"
          : "账号 Agent 的专属默认值优先于总控 Skill 的普通默认值。",
      effectiveValue: includeImageText.value,
    },
  ];

  if (!input.contentGoal) {
    conflicts.push({
      id: "content-goal-default",
      title: "缺失内容目标时如何处理",
      kind: input.persona === "demob" ? "ambiguity" : "default",
      status:
        input.persona === "demob"
          ? "needs-confirmation"
          : "resolved-with-suggestion",
      sources: [
        {
          path: "skills/xhs-content-controller/SKILL.md",
          claim: "标记待确认，并选择最安全的可能目标。",
        },
        {
          path: personaAgent,
          claim:
            input.persona === "demoa"
              ? "默认按咨询处理。"
              : "默认按跑量/信任处理，存在两个候选值。",
        },
      ],
      resolution: `建议“${suggestedGoal}”，但状态保持为待确认，不视为用户已确认。`,
      effectiveValue: suggestedGoal,
    });
  }

  conflicts.push({
    id: "persona-fact-precision",
    title: "人物年级与学校细节存在时点或真实性风险",
    kind: "fact",
    status: "needs-confirmation",
    sources: [
      {
        path: personaRule,
        claim: "包含具体家庭、年级或学校背景。",
      },
      {
        path: personaAgent,
        claim: "不同样例中出现可能随时间变化的年级表述。",
      },
    ],
    resolution:
      "装配人设语气与内容边界，但不把具体学校、年级或经历当成已核实事实；生成前需由用户提供或确认。",
  });

  return { config, conflicts };
}
