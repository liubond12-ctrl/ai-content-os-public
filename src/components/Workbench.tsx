"use client";

import { FormEvent, useMemo, useState } from "react";

import type {
  AssemblyResult,
  ComparisonResult,
  ManifestModule,
  ResolvedTaskConfig,
  RuleConflict,
  TaskInput,
} from "@/context";

import { demoScenarios } from "./scenarios";

type InspectorTab = "loaded" | "skipped" | "conflicts" | "context";

interface FormState {
  persona: "demoa" | "demob";
  topic: string;
  contentGoal: "" | "跑量" | "信任" | "咨询" | "转化";
  riskLevel: "低风险" | "严格避开升学" | "有条件讨论";
  imageMode: "auto" | "yes" | "no";
  bodyLength: string;
  testVariable: string;
  additionalConstraints: string;
}

function toFormState(input: TaskInput): FormState {
  return {
    persona: input.persona,
    topic: input.topic,
    contentGoal: input.contentGoal ?? "",
    riskLevel: input.riskLevel ?? "低风险",
    imageMode:
      input.includeImageText === undefined
        ? "auto"
        : input.includeImageText
          ? "yes"
          : "no",
    bodyLength: input.bodyLength?.toString() ?? "",
    testVariable: input.testVariable ?? "",
    additionalConstraints: input.additionalConstraints ?? "",
  };
}

function toTaskInput(form: FormState): TaskInput {
  return {
    persona: form.persona,
    topic: form.topic.trim(),
    ...(form.contentGoal ? { contentGoal: form.contentGoal } : {}),
    riskLevel: form.riskLevel,
    ...(form.imageMode === "auto"
      ? {}
      : { includeImageText: form.imageMode === "yes" }),
    ...(form.bodyLength
      ? { bodyLength: Number.parseInt(form.bodyLength, 10) }
      : {}),
    ...(form.testVariable.trim()
      ? { testVariable: form.testVariable.trim() }
      : {}),
    ...(form.additionalConstraints.trim()
      ? { additionalConstraints: form.additionalConstraints.trim() }
      : {}),
  };
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-5)}`;
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    explicit: "本次输入",
    "persona-default": "账号默认",
    "global-default": "全局默认",
    inferred: "系统建议",
    system: "系统约束",
  };
  return labels[source] ?? source;
}

function valueLabel(value: unknown) {
  if (value === null) return "未提供";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function layerLabel(layer: ManifestModule["semanticLayer"]) {
  const labels: Record<ManifestModule["semanticLayer"], string> = {
    system: "系统",
    safety: "安全",
    persona: "人设",
    format: "格式",
    experiment: "实验",
    supplemental: "补充",
    metadata: "元数据",
  };
  return labels[layer];
}

function LayerList({
  items,
  emptyText,
}: {
  items: Array<ManifestModule & { duplicateOf?: string }>;
  emptyText: string;
}) {
  if (!items.length) return <p className="empty-state">{emptyText}</p>;
  return (
    <div className="layer-stack">
      {items.map((item, index) => (
        <article
          className={`layer-card layer-${item.semanticLayer}`}
          key={`${item.id}-${item.path}`}
          style={{ "--layer-index": index } as React.CSSProperties}
        >
          <div className="layer-card-head">
            <span className="layer-type">{layerLabel(item.semanticLayer)}</span>
            <span className="layer-priority">
              {item.priority ? `P${item.priority}` : "跳过"}
            </span>
          </div>
          <h3>{item.label}</h3>
          <p>{item.reason}</p>
          <dl className="module-meta">
            <div>
              <dt>路径</dt>
              <dd>{item.path}</dd>
            </div>
            <div>
              <dt>哈希</dt>
              <dd title={item.sha256}>{shortHash(item.sha256)}</dd>
            </div>
            <div>
              <dt>大小</dt>
              <dd>{formatBytes(item.bytes)}</dd>
            </div>
            {item.duplicateOf ? (
              <div>
                <dt>重复于</dt>
                <dd>{item.duplicateOf}</dd>
              </div>
            ) : null}
          </dl>
        </article>
      ))}
    </div>
  );
}

function ConflictList({ conflicts }: { conflicts: RuleConflict[] }) {
  return (
    <div className="conflict-list">
      {conflicts.map((conflict) => (
        <article className="conflict-card" key={conflict.id}>
          <div className="conflict-title-row">
            <h3>{conflict.title}</h3>
            <span className={`status-pill status-${conflict.status}`}>
              {conflict.status === "needs-confirmation"
                ? "待确认"
                : conflict.status === "resolved-with-suggestion"
                  ? "建议值"
                  : "已决议"}
            </span>
          </div>
          <ul>
            {conflict.sources.map((source) => (
              <li key={`${conflict.id}-${source.path}`}>
                <strong>{source.path}</strong>
                <span>{source.claim}</span>
              </li>
            ))}
          </ul>
          <p className="resolution-copy">
            <strong>处理：</strong>
            {conflict.resolution}
          </p>
        </article>
      ))}
    </div>
  );
}

function ComparisonPanel({ comparison }: { comparison: ComparisonResult }) {
  return (
    <section className="comparison-panel" aria-labelledby="comparison-title">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">实时对比</p>
          <h2 id="comparison-title">同题切换账号</h2>
        </div>
        <span className="manifest-hash">
          {comparison.left.manifest.input.persona === "demoa" ? "示例甲" : "示例乙"}
          <span>对比</span>
          {comparison.right.manifest.input.persona === "demoa" ? "示例甲" : "示例乙"}
        </span>
      </div>
      <div className="diff-grid">
        <div>
          <h3>右侧新增 / 替换</h3>
          {comparison.diff.addedModules.map((module) => (
            <p key={module.id}>{module.label}</p>
          ))}
          {!comparison.diff.addedModules.length ? <p>无模块变化</p> : null}
        </div>
        <div>
          <h3>右侧移除 / 替换</h3>
          {comparison.diff.removedModules.map((module) => (
            <p key={module.id}>{module.label}</p>
          ))}
          {!comparison.diff.removedModules.length ? <p>无模块变化</p> : null}
        </div>
      </div>
      <div className="field-diff-list">
        {comparison.diff.changedFields.map((change) => {
          const left = change.left as ResolvedTaskConfig[keyof ResolvedTaskConfig];
          const right = change.right as ResolvedTaskConfig[keyof ResolvedTaskConfig];
          return (
            <div className="field-diff" key={change.field}>
              <strong>{change.field}</strong>
              <span>{valueLabel(left.value)}</span>
              <span>{valueLabel(right.value)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function Workbench({ initialResult }: { initialResult: AssemblyResult }) {
  const [form, setForm] = useState<FormState>(() =>
    toFormState(demoScenarios[0].input),
  );
  const [result, setResult] = useState<AssemblyResult | null>(initialResult);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [activeScenario, setActiveScenario] = useState(demoScenarios[0].id);
  const [tab, setTab] = useState<InspectorTab>("loaded");
  const [isLoading, setIsLoading] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskInput = useMemo(() => toTaskInput(form), [form]);

  async function runAssembly(input: TaskInput) {
    setIsLoading(true);
    setError(null);
    setComparison(null);
    try {
      const response = await fetch("/api/context/assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload.issues?.[0]?.message ?? payload.detail ?? payload.error,
        );
      }
      setResult(payload as AssemblyResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "装配失败");
    } finally {
      setIsLoading(false);
    }
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setActiveScenario("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void runAssembly(taskInput);
  }

  function loadScenario(id: string) {
    const scenario = demoScenarios.find((item) => item.id === id);
    if (!scenario) return;
    setForm(toFormState(scenario.input));
    setActiveScenario(id);
    void runAssembly(scenario.input);
  }

  async function comparePersona() {
    setIsComparing(true);
    setError(null);
    const alternate: TaskInput = {
      ...taskInput,
      persona: taskInput.persona === "demoa" ? "demob" : "demoa",
    };
    try {
      const response = await fetch("/api/context/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ left: taskInput, right: alternate }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? payload.error);
      setComparison(payload as ComparisonResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "对比失败");
    } finally {
      setIsComparing(false);
    }
  }

  const resolvedEntries = result
    ? (Object.entries(result.manifest.resolvedConfig) as Array<
        [keyof ResolvedTaskConfig, ResolvedTaskConfig[keyof ResolvedTaskConfig]]
      >)
    : [];

  return (
    <main className="app-shell">
      <header className="masthead">
        <div>
          
          <h1>账号规则与上下文装配</h1>
          <p className="masthead-copy">
            真实读取规则、解释默认值、暴露冲突，并为每次装配留下可比较的 Manifest。
          </p>
        </div>
        <div className="phase-card">
          <span>Phase 1</span>
          <strong>规则装配已启用</strong>
          <small>未调用 RAG、Agent 编排或模型评分</small>
        </div>
      </header>

      <section className="scenario-strip" aria-label="可运行测试场景">
        <div className="scenario-intro">
          <span>03</span>
          <p>可运行场景</p>
        </div>
        {demoScenarios.map((scenario) => (
          <button
            className={activeScenario === scenario.id ? "scenario active" : "scenario"}
            key={scenario.id}
            onClick={() => loadScenario(scenario.id)}
            type="button"
          >
            <strong>{scenario.name}</strong>
            <span>{scenario.summary}</span>
          </button>
        ))}
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="workbench-grid">
        <aside className="task-panel panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">任务输入</p>
              <h2>配置本次装配</h2>
            </div>
            <span className="step-number">01</span>
          </div>
          <form onSubmit={handleSubmit}>
            <fieldset>
              <legend>账号角色</legend>
              <div className="segmented-control">
                <button
                  className={form.persona === "demoa" ? "selected" : ""}
                  onClick={() => updateField("persona", "demoa")}
                  type="button"
                >
                  示例甲
                </button>
                <button
                  className={form.persona === "demob" ? "selected" : ""}
                  onClick={() => updateField("persona", "demob")}
                  type="button"
                >
                  示例乙
                </button>
              </div>
            </fieldset>

            <label>
              <span>选题</span>
              <textarea
                maxLength={240}
                onChange={(event) => updateField("topic", event.target.value)}
                required
                rows={4}
                value={form.topic}
              />
            </label>

            <div className="form-row">
              <label>
                <span>内容目标</span>
                <select
                  onChange={(event) =>
                    updateField(
                      "contentGoal",
                      event.target.value as FormState["contentGoal"],
                    )
                  }
                  value={form.contentGoal}
                >
                  <option value="">待系统建议</option>
                  <option value="跑量">跑量</option>
                  <option value="信任">信任</option>
                  <option value="咨询">咨询</option>
                  <option value="转化">转化</option>
                </select>
              </label>
              <label>
                <span>风险级别</span>
                <select
                  onChange={(event) =>
                    updateField(
                      "riskLevel",
                      event.target.value as FormState["riskLevel"],
                    )
                  }
                  value={form.riskLevel}
                >
                  <option value="低风险">低风险</option>
                  <option value="严格避开升学">严格避开升学</option>
                  <option value="有条件讨论">有条件讨论</option>
                </select>
              </label>
            </div>

            <div className="form-row">
              <label>
                <span>配图文字</span>
                <select
                  onChange={(event) =>
                    updateField(
                      "imageMode",
                      event.target.value as FormState["imageMode"],
                    )
                  }
                  value={form.imageMode}
                >
                  <option value="auto">按账号默认</option>
                  <option value="yes">明确需要</option>
                  <option value="no">明确不需要</option>
                </select>
              </label>
              <label>
                <span>正文长度</span>
                <input
                  max={2000}
                  min={300}
                  onChange={(event) => updateField("bodyLength", event.target.value)}
                  placeholder="默认 850"
                  type="number"
                  value={form.bodyLength}
                />
              </label>
            </div>

            <label>
              <span>测试变量</span>
              <input
                maxLength={160}
                onChange={(event) => updateField("testVariable", event.target.value)}
                placeholder="留空则不加载实验复盘规则"
                value={form.testVariable}
              />
            </label>

            <label>
              <span>补充约束</span>
              <textarea
                maxLength={1200}
                onChange={(event) =>
                  updateField("additionalConstraints", event.target.value)
                }
                placeholder="不能覆盖安全与事实约束"
                rows={3}
                value={form.additionalConstraints}
              />
            </label>

            <div className="form-actions">
              <button className="primary-button" disabled={isLoading} type="submit">
                {isLoading ? "装配中…" : "运行装配"}
              </button>
              <button
                className="secondary-button"
                disabled={isComparing || !result}
                onClick={() => void comparePersona()}
                type="button"
              >
                {isComparing ? "对比中…" : "同题切换账号对比"}
              </button>
            </div>
          </form>
        </aside>

        <section className="result-panel panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">生效配置</p>
              <h2>Resolved Task Config</h2>
            </div>
            <span className="step-number">02</span>
          </div>

          {result ? (
            <>
              <div className="metric-row">
                <div>
                  <span>加载</span>
                  <strong>{result.manifest.loadedModules.length}</strong>
                  <small>个模块</small>
                </div>
                <div>
                  <span>跳过</span>
                  <strong>{result.manifest.skippedModules.length}</strong>
                  <small>个模块</small>
                </div>
                <div>
                  <span>冲突</span>
                  <strong>{result.manifest.conflicts.length}</strong>
                  <small>条记录</small>
                </div>
                <div>
                  <span>估算</span>
                  <strong>{result.manifest.tokenEstimate.value.toLocaleString()}</strong>
                  <small>tokens</small>
                </div>
              </div>

              <div className="resolved-list">
                {resolvedEntries.map(([field, resolved]) => (
                  <article className="resolved-row" key={field}>
                    <div>
                      <span>{field}</span>
                      <strong>{valueLabel(resolved.value)}</strong>
                    </div>
                    <div className="resolution-meta">
                      <span>{sourceLabel(resolved.source)}</span>
                      <span
                        className={
                          resolved.status === "suggested"
                            ? "confirmation-needed"
                            : ""
                        }
                      >
                        {resolved.status === "suggested" ? "待确认" : "已生效"}
                      </span>
                    </div>
                    <p>{resolved.rationale}</p>
                  </article>
                ))}
              </div>

              <div className="integrity-card">
                <div>
                  <span>Assembly hash</span>
                  <strong title={result.manifest.assemblyHash}>
                    {shortHash(result.manifest.assemblyHash)}
                  </strong>
                </div>
                <p>
                  相同输入与相同资源版本会产生相同哈希；token 数为中英文混合启发式估算。
                </p>
              </div>

              {comparison ? <ComparisonPanel comparison={comparison} /> : null}
            </>
          ) : (
            <p className="empty-state">运行一次装配后查看结果。</p>
          )}
        </section>

        <aside className="inspector-panel panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Context Inspector</p>
              <h2>Manifest</h2>
            </div>
            <span className="step-number">03</span>
          </div>

          <div className="tab-list" role="tablist" aria-label="Manifest 视图">
            {(
              [
                ["loaded", "已加载"],
                ["skipped", "未加载"],
                ["conflicts", "冲突"],
                ["context", "上下文"],
              ] as Array<[InspectorTab, string]>
            ).map(([id, label]) => (
              <button
                aria-selected={tab === id}
                className={tab === id ? "active" : ""}
                key={id}
                onClick={() => setTab(id)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="inspector-content">
            {!result ? (
              <p className="empty-state">等待装配结果。</p>
            ) : tab === "loaded" ? (
              <LayerList
                emptyText="本次没有加载模块。"
                items={result.manifest.loadedModules}
              />
            ) : tab === "skipped" ? (
              <LayerList
                emptyText="本次没有跳过模块。"
                items={result.manifest.skippedModules}
              />
            ) : tab === "conflicts" ? (
              <ConflictList conflicts={result.manifest.conflicts} />
            ) : (
              <div className="context-preview">
                <div>
                  <span>字符数</span>
                  <strong>{result.manifest.contextCharacters.toLocaleString()}</strong>
                </div>
                <pre>{result.compiledContext}</pre>
              </div>
            )}
          </div>
        </aside>
      </div>

      <footer>
        <p>
          本阶段只实现可追溯的上下文选择、装配、冲突决议与对比。PDF 平台结论未作为默认事实注入。
        </p>
      </footer>
    </main>
  );
}
