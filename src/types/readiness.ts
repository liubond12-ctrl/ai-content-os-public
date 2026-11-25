import {z} from "zod";

export const automationPolicy=z.object({
  matchMin:z.number().int().min(0).max(100),
  dailyMicros:z.number().int().min(1000).max(100_000_000_000),
}).strict();
export type AutomationPolicy=z.infer<typeof automationPolicy>;
export const defaultAutomationPolicy:AutomationPolicy={matchMin:75,dailyMicros:10_000_000};
export const seriesKey=z.object({label:z.string().trim().min(1).max(80),episode:z.number().int().min(1).max(9999)}).strict();
export type SeriesKey=z.infer<typeof seriesKey>;
export const seriesSource=z.object({task:z.uuid(),version:z.number().int().positive(),episode:z.number().int().positive(),title:z.string(),summary:z.string()}).strict();
export const profileMatch=z.object({score:z.number().int().min(0).max(100)}).strict();
export type DoctorCheck={name:string;status:"通过"|"异常"|"待授权验证"|"未配置"|"模拟";detail:string;next:string;basis:string};
export type ReadinessTask={label:string;count:number;href:string};
