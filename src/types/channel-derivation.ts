import {z} from "zod";

export const channelVariant = z.enum(["xiaohongshu","douyin-script","douyin-post","wechat"]);
export type ChannelVariant = z.infer<typeof channelVariant>;

const line = z.string().trim().min(1).max(300);
const paragraph = z.string().trim().min(1).max(4000);
const body = z.string().trim().min(1).max(35000);
const common = {keywords:z.array(line).max(12),cta:z.string().trim().max(600)};

export const channelContent = z.discriminatedUnion("variant",[
  z.object({...common,variant:z.literal("xiaohongshu"),
    titles:z.array(line.refine(text=>Array.from(text).length<=20,"标题最多 20 字")).length(3).refine(titles=>new Set(titles).size===3,"请填写 3 条不同标题"),
    body,tags:z.array(line).length(8).refine(tags=>new Set(tags.map(tag=>tag.replace(/^#+/,"").toLowerCase())).size===8,"标签需为 8 个不同词"),
    comments:z.array(z.object({question:line,answer:paragraph}).strict()).length(3),
  }).strict(),
  z.object({...common,variant:z.literal("douyin-script"),title:line,hooks:z.array(line).length(3),script:body.refine(
    text=>text.includes("[画面提示]")&&text.includes("[重音停顿]"),"逐字稿需有画面提示和重音停顿",
  )}).strict(),
  z.object({...common,variant:z.literal("douyin-post"),title:line,slides:z.array(paragraph).min(2).max(20)}).strict(),
  z.object({...common,variant:z.literal("wechat"),title:line,
    blocks:z.array(z.object({kind:z.enum(["paragraph","quote","highlight","step"]),text:paragraph}).strict()).min(1).max(100),
  }).strict(),
]);

export type ChannelContent = z.infer<typeof channelContent>;
export interface ChannelDerivation {
  taskId: string;
  articleVersion: number;
  revision: number;
  updatedAt: string;
  rulesVersion: string;
  content: ChannelContent;
}
export interface ChannelRisk {
  field: string;
  text: string;
  start: number;
  end: number;
  reason: string;
}

export const variantLabels:Record<ChannelVariant,string> = {
  xiaohongshu:"小红书", "douyin-script":"抖音 · 口播逐字稿", "douyin-post":"抖音 · 短图文", wechat:"公众号",
};
