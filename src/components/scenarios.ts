import type { TaskInput } from "@/context";

export interface DemoScenario {
  id: string;
  name: string;
  summary: string;
  input: TaskInput;
}

export const demoScenarios: DemoScenario[] = [
  {
    id: "demoa-stage-switch",
    name: "示例甲 · 转段判断",
    summary: "观察账号默认配图、咨询目标建议与实验规则加载。",
    input: {
      persona: "demoa",
      topic: "三年级还在学图形化，真的晚了吗？",
      riskLevel: "低风险",
      testVariable: "低龄家长焦虑与转段判断",
    },
  },
  {
    id: "demob-no-image",
    name: "示例乙 · 明确不配图",
    summary: "验证显式 false 覆盖 Agent 默认值，并保留目标待确认。",
    input: {
      persona: "demob",
      topic: "孩子数学应用题总卡住，我后来才发现不是数学的问题",
      riskLevel: "严格避开升学",
      includeImageText: false,
      testVariable: "读题与拆问题能力",
    },
  },
  {
    id: "demoa-explicit-goal",
    name: "示例甲 · 全字段任务",
    summary: "验证显式目标、长度与事实约束的来源追踪。",
    input: {
      persona: "demoa",
      topic: "Python 学了一年，要不要转 C++？",
      contentGoal: "咨询",
      riskLevel: "有条件讨论",
      includeImageText: true,
      bodyLength: 920,
      testVariable: "路线争议与评论入口",
      additionalConstraints:
        "不得引用未经核实的学校、竞赛成绩或升学政策；只给阶段判断。",
    },
  },
];
