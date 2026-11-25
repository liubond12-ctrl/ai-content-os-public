import { createHash } from "node:crypto";

import {
  materializeDefinition,
  moduleDefinitions,
  personaPaths,
} from "./config";
import { buildResourceInventory, readResourceText } from "./inventory";
import { resolveTaskConfig } from "./resolve";
import type {
  AssemblyResult,
  ManifestModule,
  ResourceRecord,
  SkippedModule,
  TaskInput,
} from "./types";

function recordKey(root: "source" | "system", relativePath: string) {
  return `${root}:${relativePath}`;
}

function publicPath(record: ResourceRecord) {
  return record.root === "system"
    ? `resources/system/${record.relativePath}`
    : `resources/source-pack/content-production-system/${record.relativePath}`;
}

function estimateTokens(content: string) {
  const cjk = content.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const remaining = Math.max(0, content.length - cjk);
  return cjk + Math.ceil(remaining / 4);
}

function labelForSkipped(record: ResourceRecord) {
  const fileName = record.relativePath.split("/").at(-1) ?? record.relativePath;
  return fileName.replace(/\.(md|yaml|yml|pdf|docx)$/i, "");
}

function layerForSkipped(record: ResourceRecord): SkippedModule["semanticLayer"] {
  if (record.extension === ".pdf" || record.extension === ".docx") {
    return "supplemental";
  }
  if (/openai\.yaml$/.test(record.relativePath)) return "metadata";
  if (/风险|总控/.test(record.relativePath)) return "safety";
  if (/人设|persona|agent/.test(record.relativePath)) return "persona";
  if (/模板/.test(record.relativePath)) return "format";
  if (/实验|复盘/.test(record.relativePath)) return "experiment";
  return "metadata";
}

function skipReason(
  record: ResourceRecord,
  input: TaskInput,
  loadedByHash: Map<string, ManifestModule>,
) {
  const duplicate = loadedByHash.get(record.sha256);
  if (duplicate) {
    return {
      reason: `内容哈希与已加载的 ${duplicate.label} 相同，避免重复注入。`,
      duplicateOf: duplicate.path,
    };
  }

  const otherPersona = input.persona === "demoa" ? "demob" : "demoa";
  const otherPaths = new Set([
    personaPaths.rules[otherPersona],
    personaPaths.agents[otherPersona],
    personaPaths.skills[otherPersona],
  ]);
  if (otherPaths.has(record.relativePath)) {
    return { reason: "属于另一个账号的人设上下文，本次明确跳过。" };
  }
  if (record.extension === ".pdf") {
    return {
      reason:
        "平台机制补充资料未附可追溯来源，且本任务不做平台分发诊断；不作为默认事实注入。",
    };
  }
  if (record.extension === ".docx") {
    return {
      reason: "仅在具体的具象化改写任务中按需读取，常规装配不默认注入。",
    };
  }
  if (/openai\.yaml$/.test(record.relativePath)) {
    return { reason: "这是 Skill 展示元数据，不是本次任务执行规则。" };
  }
  if (/README/.test(record.relativePath)) {
    return { reason: "迁移或使用说明，不作为生成任务上下文。" };
  }
  if (record.relativePath === "05_选题实验与复盘规则.md") {
    return { reason: "当前任务未提供测试变量、跑量目标或显式实验要求。" };
  }
  return { reason: "未被当前 Phase 1 选择策略命中。" };
}

export async function assembleContext(input: TaskInput): Promise<AssemblyResult> {
  const inventory = await buildResourceInventory();
  const recordMap = new Map(
    inventory.map((record) => [recordKey(record.root, record.relativePath), record]),
  );
  const definitions = moduleDefinitions
    .map((definition) => materializeDefinition(definition, input.persona))
    .filter((definition) => definition.shouldLoad(input))
    .sort((a, b) => b.priority - a.priority);

  const loadedModules: ManifestModule[] = [];
  const contentParts: string[] = [];
  const loadedKeys = new Set<string>();

  for (const definition of definitions) {
    const key = recordKey(definition.root, definition.relativePath);
    const record = recordMap.get(key);
    if (!record) {
      throw new Error(`Configured resource is missing: ${key}`);
    }
    const content = await readResourceText(record);
    const manifestModule: ManifestModule = {
      id: definition.id,
      label: definition.label,
      path: publicPath(record),
      semanticLayer: definition.semanticLayer,
      priority: definition.priority,
      sha256: record.sha256,
      bytes: record.bytes,
      contentCharacters: content.length,
      reason: definition.reason(input),
    };
    loadedKeys.add(key);
    loadedModules.push(manifestModule);
    contentParts.push(
      [
        `## Module: ${definition.label}`,
        `Source: ${manifestModule.path}`,
        `SHA256: ${manifestModule.sha256}`,
        `Priority: ${manifestModule.priority}`,
        "",
        content.trim(),
      ].join("\n"),
    );
  }

  const loadedByHash = new Map(
    loadedModules.map((module) => [module.sha256, module]),
  );
  const skippedModules: SkippedModule[] = inventory
    .filter((record) => !loadedKeys.has(recordKey(record.root, record.relativePath)))
    .map((record) => {
      const skipped = skipReason(record, input, loadedByHash);
      return {
        id: record.id,
        label: labelForSkipped(record),
        path: publicPath(record),
        semanticLayer: layerForSkipped(record),
        priority: 0,
        sha256: record.sha256,
        bytes: record.bytes,
        reason: skipped.reason,
        duplicateOf: skipped.duplicateOf,
      };
    });

  const { config, conflicts } = resolveTaskConfig(input);
  const taskHeader = [
    "# Resolved task configuration",
    "",
    JSON.stringify(config, null, 2),
    "",
    "# Conflict decisions",
    "",
    JSON.stringify(conflicts, null, 2),
  ].join("\n");
  const compiledContext = [taskHeader, ...contentParts].join("\n\n---\n\n");
  const assemblyHash = createHash("sha256")
    .update(compiledContext)
    .digest("hex");

  return {
    compiledContext,
    manifest: {
      version: "phase1-v1",
      input,
      resolvedConfig: config,
      loadedModules,
      skippedModules,
      conflicts,
      contextCharacters: compiledContext.length,
      tokenEstimate: {
        value: estimateTokens(compiledContext),
        method: "cjk-plus-latin-heuristic",
        isEstimate: true,
      },
      assemblyHash,
    },
  };
}
