import {z} from "zod";

export const versionKey=z.object({task:z.uuid(),version:z.number().int().positive()}).strict();
export const metrics=z.object({reach:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),likes:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  saves:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),comments:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  conversions:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict();
export type Metrics=z.infer<typeof metrics>;
export type MetricRanges=Record<keyof Metrics,readonly [number,number]>;
export type VersionKey=z.infer<typeof versionKey>;
export type BlindPrediction=VersionKey & {
  account:string; lockedAt:string; level:"试探"|"稳定"|"高潜"; score:number; bet:string;
  ranges:MetricRanges; reviewId:string; reviewVersion:number; rubricVersion:number;
  rules:Array<{id:string;version:number}>;
  initialVersion:number; title:string; body:string;
};
export const rubricFocus=z.enum(["结构","具体表达","互动引导"]);
export type RubricFocus=z.infer<typeof rubricFocus>;
export type Retro=VersionKey & {id:string; observedAt:string; addedAt:string; source:string; metrics:Metrics;
  reachDelta:number; beat:boolean; attribution:string; authorDiff:{before:string;after:string};};
export type CalibrationCheck={
  focus:RubricFocus; samples:Array<VersionKey & {title:string;score:number;reach:number}>;
  comparable:number; aligned:number; agreement:number|null; passed:boolean;
  conflicts:Array<{higher:string;lower:string;reason:string}>;
};
export type RubricBumpProposal=CalibrationCheck & {id:string; account:string;fingerprint:string; createdAt:string; reason:string;appliedVersion?:number};
export const brickKind=z.enum(["Hook","真实案例","方法论","CTA"]);
export const brickPin=z.object({id:z.uuid(),version:z.number().int().positive()}).strict();
export type BrickPin=z.infer<typeof brickPin>;
export const atomicBrick=brickPin.extend({account:z.string().min(1),kind:brickKind,text:z.string().trim().min(1).max(1500),
  tags:z.array(z.string().min(1).max(50)).max(10),source:z.object({kind:z.enum(["article","reference"]),id:z.string(),version:z.number().int().positive(),title:z.string()}).strict(),
  winRate:z.number().min(0).max(1).nullable()}).strict();
export type AtomicBrick=z.infer<typeof atomicBrick>;
export const routePurpose=z.enum(["default","research","long-form","quick-review","distribution"]);
export type RoutePurpose=z.infer<typeof routePurpose>;
export const modelRoute=z.object({model:z.string().trim().min(1).max(120),
  url:z.string().regex(/^http:\/\/127\.0\.0\.1(?::\d+)?\/[^@?#\\\s]*$/),
  concurrency:z.number().int().min(1).max(16)}).strict();
