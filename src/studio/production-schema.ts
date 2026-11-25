import {z} from "zod";

export const productionPlatforms = ["小红书","抖音","公众号"] as const;
export const productionPlatform = z.enum(["",...productionPlatforms]);

export const contentKind=z.enum(["图文","口播稿","分镜脚本","自由文章"]);
export const ruleSnapshot=z.object({
  id:z.string(),version:z.number().int(),name:z.string(),body:z.string(),hash:z.string(),
  hard:z.boolean(),reason:z.string(),
});
export const productionBudgetSchema=z.object({
  profile:z.enum(["protected","local_extended","cloud_review"]),requests:z.number().int().positive(),tokens:z.number().int().positive(),
  output:z.number().int().positive(),minimumRequests:z.number().int(),fullFlowRequests:z.number().int(),notice:z.string(),
});
export function productionBudget(kind:z.infer<typeof contentKind>,profile="protected"){
  const extended=profile==="local_extended"||profile==="cloud_review";
  return {profile:profile==="cloud_review"?"cloud_review" as const:extended?"local_extended" as const:"protected" as const,requests:extended?32:6,tokens:extended?120000:20000,
    output:extended?(kind==="自由文章"||kind==="分镜脚本"?6000:3000):800,minimumRequests:4,fullFlowRequests:22,
    notice:profile==="cloud_review"?"真实云端原创验收：本次未设总费用上限；保留有限请求、超时及两轮修订保护":extended?"仅本机长文协作：预留多轮审核与修订，仍受任务及批次额度约束":"保守额度：800 Tokens 可能截断长文；实质分歧和多轮修订可能触顶，触顶转人工，不自动扩额"};
}
export const productionInput=z.object({
  brand:z.literal("default"),account:z.string(),accountName:z.string(),accountDescription:z.string(),platform:productionPlatform,
  kind:contentKind,outline:z.string().max(4000),requirements:z.string().max(4000),
  rules:z.array(ruleSnapshot),standards:z.array(ruleSnapshot),
  attachments:z.array(z.object({id:z.string(),name:z.string(),text:z.string().max(200000),source:z.string(),purpose:z.enum(["facts","style"]).optional()})),
  authorBrief:z.string().max(12000).optional(),writingPreference:z.string().max(600).optional(),
  budget:productionBudgetSchema.optional(),imagesRequired:z.boolean(),mode:z.enum(["离线示例","本机模型","真实云端"]),
});
export const sectionNames={
  "图文":["封面文案","正文","配图计划"],
  "口播稿":["开场","口播正文","字幕建议","目标时长（估算）"],
  "分镜脚本":["镜头顺序","画面建议","口播或对白","字幕","预计时长（估算）"],
  "自由文章":["正文"],
};
export const structuredOutput=z.object({
  title:z.string().min(1),citations:z.array(z.string()),
  sections:z.array(z.object({name:z.string().min(1),text:z.string().min(1)})).min(1),
}).strict();
export function renderSections(kind:z.infer<typeof contentKind>,sections:z.infer<typeof structuredOutput>["sections"]){
  if(new Set(sections.map(s=>s.name)).size!==sections.length)throw Error("内容栏目重复");
  if(sectionNames[kind].some(name=>!sections.some(s=>s.name===name)))throw Error("内容结构缺少必要栏目");
  return sections.map(s=>"## "+s.name+"\n"+s.text).join("\n\n");
}
export function validateBody(kind:z.infer<typeof contentKind>,body:string){
  const sections=body.split(/^## /m).slice(1).map(s=>({name:s.slice(0,s.indexOf("\n")).trim(),text:s.slice(s.indexOf("\n")+1).trim()}));
  renderSections(kind,sections);
  if(sections.some(s=>!s.text))throw Error("内容栏目不能为空");
  return sections;
}
