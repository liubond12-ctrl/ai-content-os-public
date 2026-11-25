export type ReviewExpertRole = "strategy" | "language" | "facts" | "basic";

export interface ReviewAnchor {
  field: "title" | "body";
  quote: string;
  offset: number;
}

export interface ReviewSuggestion {
  id: string;
  anchor: ReviewAnchor;
  problem: string;
  suggestion: string;
  severity: "轻微" | "明显" | "严重";
  replacement?: string;
}

export interface ReviewExpert {
  role: ReviewExpertRole;
  score: number;
  observation: string;
  suggestions: ReviewSuggestion[];
}

export interface ConflictResolutionOption {
  id: string;
  role: ReviewExpertRole;
  anchor: ReviewAnchor;
  action: "retain" | "delete" | "replace";
  text: string;
  reason: string;
}

export interface ReviewConflict {
  id: string;
  options: ConflictResolutionOption[];
  verdict?: string;
}

export interface ReviewExchange {
  id: string;
  role: ReviewExpertRole;
  stance: "agree" | "oppose" | "supplement" | "maintain" | "withdraw";
  message: string;
}

export interface MultiAgentReviewVisual {
  version: number;
  summary: string[];
  experts: ReviewExpert[];
  conflicts: ReviewConflict[];
  exchanges: ReviewExchange[];
}

export type LocalArticleEdit =
  | { kind: "replace"; anchor: ReviewAnchor; text: string }
  | { kind: "append"; text: string };

/** Written atomically with the author draft. IDs scope a suggestion or conflict group. */
export const endingEditId = "brief:ending";
