import {z} from "zod";

export const cruisePolicy=z.object({
  enabled:z.boolean(),time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  minScore:z.number().int().min(0).max(100),
  maxTasks:z.number().int().min(1).max(6),
  requestLimit:z.number().int().min(32).max(200),
  tokenLimit:z.number().int().min(20000).max(500000),
}).strict();
export type CruisePolicy=z.infer<typeof cruisePolicy>;
export const defaultCruisePolicy:CruisePolicy={enabled:false,time:"03:00",minScore:70,maxTasks:4,requestLimit:160,tokenLimit:120000};
export interface MorningCandidate {
  taskId:string; articleVersion:number; draftRevision:number; reviewId:string;
  title:string; account:string; summary:string; score:number; disagreements:string[];
}
export interface LedgerRecord {
  articleId:string; articleVersion:number; title:string; account:string;
  channels:{xiaohongshu:number;douyinScript:number;douyinPost:number;wechat:number};
  scheduledAt:string|null;
}
export type LedgerState="pending"|"unknown"|"retry"|"sent";
export const AUTOPILOT_HOP_LIMIT=8;
export type AutopilotPhase="generation"|"review"|"revision";
export const cruiseMaterial=z.object({
  id:z.string(),title:z.string().max(240),text:z.string().max(8000),source:z.string(),
  type:z.enum(["hot-topic","writing-reference"]),reference:z.string().optional(),
}).strict();
export type CruiseMaterial=z.infer<typeof cruiseMaterial>;
