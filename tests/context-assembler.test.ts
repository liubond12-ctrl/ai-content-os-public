import { describe, expect, it } from "vitest";

import {
  assembleContext,
  compareContexts,
  taskInputSchema,
} from "../src/context";

const baseInput = {
  persona: "demoa" as const,
  topic: "三年级还在学图形化，真的晚了吗？",
  riskLevel: "低风险" as const,
};

describe("Context Assembler", () => {
  it("示例甲任务不会把示例乙人设作为生效上下文", async () => {
    const result = await assembleContext(baseInput);
    const loadedPaths = result.manifest.loadedModules.map((item) => item.path);
    expect(loadedPaths.some((path) => path.includes("示例甲"))).toBe(true);
    expect(loadedPaths.some((path) => path.includes("demob"))).toBe(false);
    expect(loadedPaths.some((path) => path.includes("示例乙"))).toBe(false);
  });

  it("示例乙任务不会把示例甲人设作为生效上下文", async () => {
    const result = await assembleContext({
      ...baseInput,
      persona: "demob",
    });
    const loadedPaths = result.manifest.loadedModules.map((item) => item.path);
    expect(loadedPaths.some((path) => path.includes("示例乙"))).toBe(true);
    expect(loadedPaths.some((path) => path.includes("demoa"))).toBe(false);
    expect(loadedPaths.some((path) => path.includes("示例甲"))).toBe(false);
  });

  it("同一选题切换人设会改变 Persona 模块与生效配置", async () => {
    const comparison = await compareContexts(baseInput, {
      ...baseInput,
      persona: "demob",
    });
    expect(comparison.diff.addedModules.some((item) => item.id === "persona-rules")).toBe(true);
    expect(comparison.diff.removedModules.some((item) => item.id === "persona-rules")).toBe(true);
    expect(comparison.diff.changedFields.some((item) => item.field === "persona")).toBe(true);
  });

  it("显式 includeImageText=false 覆盖 Agent 默认值并记录决议", async () => {
    const result = await assembleContext({
      ...baseInput,
      includeImageText: false,
    });
    expect(result.manifest.resolvedConfig.includeImageText.value).toBe(false);
    expect(result.manifest.resolvedConfig.includeImageText.source).toBe("explicit");
    expect(
      result.manifest.conflicts.find((item) => item.id === "image-text-default")
        ?.resolution,
    ).toContain("显式输入优先");
  });

  it("未指定内容目标时只给建议且保持待确认状态", async () => {
    const result = await assembleContext(baseInput);
    expect(result.manifest.resolvedConfig.contentGoal.value).toBe("咨询");
    expect(result.manifest.resolvedConfig.contentGoal.status).toBe("suggested");
    expect(result.manifest.resolvedConfig.contentGoal.source).toBe("inferred");
  });

  it("相同输入与资源版本生成稳定 Manifest 哈希", async () => {
    const first = await assembleContext(baseInput);
    const second = await assembleContext(baseInput);
    expect(first.manifest.assemblyHash).toBe(second.manifest.assemblyHash);
    expect(first.compiledContext).toBe(second.compiledContext);
  });

  it("非法账号、空选题和任意路径字段不能进入装配", () => {
    expect(
      taskInputSchema.safeParse({ persona: "unknown", topic: "测试" }).success,
    ).toBe(false);
    expect(
      taskInputSchema.safeParse({ persona: "demoa", topic: "" }).success,
    ).toBe(false);
    expect(
      taskInputSchema.safeParse({
        persona: "demoa",
        topic: "测试",
        filePath: "C:/Windows/System32/config/SAM",
      }).success,
    ).toBe(false);
  });

  it("相同哈希的 references 会被标记为重复且不重复注入", async () => {
    const result = await assembleContext(baseInput);
    const duplicates = result.manifest.skippedModules.filter(
      (item) => item.duplicateOf,
    );
    expect(duplicates.length).toBe(4);
    expect(
      result.manifest.loadedModules.filter((item) => item.id === "global-controller"),
    ).toHaveLength(1);
    expect(
      new Set(result.manifest.loadedModules.map((item) => item.sha256)).size,
    ).toBe(result.manifest.loadedModules.length);
  });

  it("只有需要实验复盘时才加载实验规则", async () => {
    const ordinary = await assembleContext(baseInput);
    const experiment = await assembleContext({
      ...baseInput,
      testVariable: "转段判断",
    });
    expect(
      ordinary.manifest.loadedModules.some((item) => item.id === "experiment-rules"),
    ).toBe(false);
    expect(
      experiment.manifest.loadedModules.some((item) => item.id === "experiment-rules"),
    ).toBe(true);
  });

  it("编译上下文包含真实源文件内容与来源哈希", async () => {
    const result = await assembleContext(baseInput);
    expect(result.compiledContext).toContain("# 00_总控生产规则");
    expect(result.compiledContext).toContain("SHA256:");
    expect(result.manifest.contextCharacters).toBe(result.compiledContext.length);
  });

  it("具体人物事实的不一致风险被显式标记为待确认", async () => {
    const result = await assembleContext(baseInput);
    const conflict = result.manifest.conflicts.find(
      (item) => item.id === "persona-fact-precision",
    );
    expect(conflict?.status).toBe("needs-confirmation");
    expect(conflict?.resolution).toContain("不把具体学校、年级或经历当成已核实事实");
  });
});
