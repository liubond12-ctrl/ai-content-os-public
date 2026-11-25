import {z} from "zod";
import {createHash} from "node:crypto";
import {ReviewError} from "./review-error";
export const CONTRACT_VERSION="research-v2";
export const decision=z.object({action:z.enum(["search","finish"]),reason:z.string().max(400).optional(),query:z.string().max(240),mode:z.enum(["keyword","semantic","hybrid"]),needsFacts:z.boolean(),questions:z.array(z.string()).max(12),optionalQuestions:z.array(z.string()).max(12).default([]),coreGaps:z.array(z.string()).max(12).default([]),limits:z.array(z.string()).max(12).default([]),sources:z.array(z.string()).max(15)}).strict();
export type ResearchDecision=z.infer<typeof decision>;
export const decisionSchema=z.toJSONSchema(decision);
export function parseDecision(raw:unknown){
  const parsed=decision.safeParse(raw);
  if(!parsed.success){
    const issue=parsed.error.issues[0];
    const value=issue.path.reduce<unknown>((v,k)=>v && typeof v==="object"?(v as Record<PropertyKey,unknown>)[k]:undefined,raw);
    const received=Array.isArray(value)?"array":value===null?"null":typeof value;
    const fingerprint=createHash("sha256").update(JSON.stringify(raw)??"undefined").digest("hex");
    // Diagnostics retain types and a fingerprint, never raw model content.
    throw new ReviewError("research_schema","RESEARCH_SCHEMA_VALIDATION_ERROR",`${issue.path.join(".")||"$"}:${issue.code}:received=${received}:contract=${CONTRACT_VERSION}:sha256=${fingerprint}`);
  }
  return parsed.data;
}
