export type PersonaId = "demoa" | "demob";
export type ContentGoal = "跑量" | "信任" | "咨询" | "转化";
export type RiskLevel = "低风险" | "严格避开升学" | "有条件讨论";
export type ResolutionSource =
  | "explicit"
  | "persona-default"
  | "global-default"
  | "inferred"
  | "system";

export interface TaskInput {
  persona: PersonaId;
  topic: string;
  contentGoal?: ContentGoal;
  riskLevel?: RiskLevel;
  includeImageText?: boolean;
  bodyLength?: number;
  testVariable?: string;
  additionalConstraints?: string;
  loadExperimentRules?: boolean;
}

export interface ResolvedField<T> {
  value: T;
  source: ResolutionSource;
  sourcePath?: string;
  status: "confirmed" | "suggested" | "enforced";
  editable: boolean;
  rationale: string;
}

export interface ResolvedTaskConfig {
  persona: ResolvedField<PersonaId>;
  topic: ResolvedField<string>;
  contentGoal: ResolvedField<ContentGoal>;
  riskLevel: ResolvedField<RiskLevel>;
  includeImageText: ResolvedField<boolean>;
  bodyLength: ResolvedField<number>;
  testVariable: ResolvedField<string | null>;
  additionalConstraints: ResolvedField<string | null>;
}

export type ConflictStatus =
  | "resolved"
  | "resolved-with-suggestion"
  | "needs-confirmation";

export interface RuleConflict {
  id: string;
  title: string;
  kind: "default" | "ambiguity" | "fact";
  status: ConflictStatus;
  sources: Array<{
    path: string;
    claim: string;
  }>;
  resolution: string;
  effectiveValue?: string | number | boolean;
}

export type SemanticLayer =
  | "system"
  | "safety"
  | "persona"
  | "format"
  | "experiment"
  | "supplemental"
  | "metadata";

export interface ResourceRecord {
  id: string;
  root: "source" | "system";
  relativePath: string;
  absolutePath: string;
  extension: string;
  bytes: number;
  sha256: string;
}

export interface ManifestModule {
  id: string;
  label: string;
  path: string;
  semanticLayer: SemanticLayer;
  priority: number;
  sha256: string;
  bytes: number;
  reason: string;
  contentCharacters?: number;
}

export interface SkippedModule extends ManifestModule {
  duplicateOf?: string;
}

export interface ContextManifest {
  version: "phase1-v1";
  input: TaskInput;
  resolvedConfig: ResolvedTaskConfig;
  loadedModules: ManifestModule[];
  skippedModules: SkippedModule[];
  conflicts: RuleConflict[];
  contextCharacters: number;
  tokenEstimate: {
    value: number;
    method: "cjk-plus-latin-heuristic";
    isEstimate: true;
  };
  assemblyHash: string;
}

export interface AssemblyResult {
  manifest: ContextManifest;
  compiledContext: string;
}

export interface ComparisonResult {
  left: AssemblyResult;
  right: AssemblyResult;
  diff: {
    addedModules: ManifestModule[];
    removedModules: ManifestModule[];
    unchangedModuleIds: string[];
    changedFields: Array<{
      field: keyof ResolvedTaskConfig;
      left: unknown;
      right: unknown;
    }>;
    conflictIdsOnlyOnLeft: string[];
    conflictIdsOnlyOnRight: string[];
  };
}
