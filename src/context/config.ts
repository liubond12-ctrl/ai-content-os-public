import type { PersonaId, SemanticLayer, TaskInput } from "./types";

export interface ModuleDefinition {
  id: string;
  label: string;
  root: "source" | "system";
  relativePath: string;
  semanticLayer: SemanticLayer;
  priority: number;
  reason: (input: TaskInput) => string;
  shouldLoad: (input: TaskInput) => boolean;
}

const personaPath: Record<PersonaId, string> = {
  demoa: "01_示例甲账号人设与内容规则.md",
  demob: "02_示例乙账号人设与内容规则.md",
};

const personaAgentPath: Record<PersonaId, string> = {
  demoa: "agents/示例甲生产agent.md",
  demob: "agents/示例乙生产agent.md",
};

const personaSkillPath: Record<PersonaId, string> = {
  demoa: "skills/xhs-demoa-persona/SKILL.md",
  demob: "skills/xhs-demob-persona/SKILL.md",
};

export const moduleDefinitions: ModuleDefinition[] = [
  {
    id: "system-constraints",
    label: "系统执行与事实约束",
    root: "system",
    relativePath: "system-constraints.md",
    semanticLayer: "system",
    priority: 100,
    reason: () => "每次装配都先加载，且不能被任务偏好覆盖。",
    shouldLoad: () => true,
  },
  {
    id: "global-controller",
    label: "总控生产规则",
    root: "source",
    relativePath: "00_总控生产规则.md",
    semanticLayer: "system",
    priority: 85,
    reason: () => "提供所有账号共用的写作目标、结构和边界。",
    shouldLoad: () => true,
  },
  {
    id: "risk-rules",
    label: "风险词与安全改写规则",
    root: "source",
    relativePath: "03_风险词库与安全改写规则.md",
    semanticLayer: "safety",
    priority: 95,
    reason: () => "安全约束对两个账号都生效，优先级高于任务偏好。",
    shouldLoad: () => true,
  },
  {
    id: "controller-skill",
    label: "内容总控 Skill",
    root: "source",
    relativePath: "skills/xhs-content-controller/SKILL.md",
    semanticLayer: "system",
    priority: 84,
    reason: () => "提供缺字段处理、装配顺序和低质量模式检查。",
    shouldLoad: () => true,
  },
  {
    id: "persona-rules",
    label: "账号人设规则",
    root: "source",
    relativePath: "",
    semanticLayer: "persona",
    priority: 75,
    reason: (input) => `任务明确选择${input.persona === "demoa" ? "示例甲" : "示例乙"}账号。`,
    shouldLoad: () => true,
  },
  {
    id: "persona-agent",
    label: "账号 Agent 规则",
    root: "source",
    relativePath: "",
    semanticLayer: "persona",
    priority: 74,
    reason: () => "提供当前账号的输入默认值、执行流程和输出约束。",
    shouldLoad: () => true,
  },
  {
    id: "persona-skill",
    label: "账号 Persona Skill",
    root: "source",
    relativePath: "",
    semanticLayer: "persona",
    priority: 73,
    reason: () => "提供当前账号的语气、内容主轴、转化入口和禁区。",
    shouldLoad: () => true,
  },
  {
    id: "format-template",
    label: "正文与配图生产模板",
    root: "source",
    relativePath: "04_正文与配图生产模板.md",
    semanticLayer: "format",
    priority: 60,
    reason: () => "任务需要形成可执行的内容结构与输出字段。",
    shouldLoad: () => true,
  },
  {
    id: "experiment-rules",
    label: "选题实验与复盘规则",
    root: "source",
    relativePath: "05_选题实验与复盘规则.md",
    semanticLayer: "experiment",
    priority: 50,
    reason: () => "任务包含测试变量、跑量目标或显式要求加载实验规则。",
    shouldLoad: (input) =>
      Boolean(
        input.loadExperimentRules ||
          input.testVariable ||
          input.contentGoal === "跑量",
      ),
  },
];

export function materializeDefinition(
  definition: ModuleDefinition,
  persona: PersonaId,
): ModuleDefinition {
  if (definition.id === "persona-rules") {
    return { ...definition, relativePath: personaPath[persona] };
  }
  if (definition.id === "persona-agent") {
    return { ...definition, relativePath: personaAgentPath[persona] };
  }
  if (definition.id === "persona-skill") {
    return { ...definition, relativePath: personaSkillPath[persona] };
  }
  return definition;
}

export const personaPaths = {
  rules: personaPath,
  agents: personaAgentPath,
  skills: personaSkillPath,
};
