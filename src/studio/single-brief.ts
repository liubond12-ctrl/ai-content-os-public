import {z} from "zod";

export const materialUse=z.object({id:z.string().uuid(),name:z.string().max(180),mime:z.string().max(40),purpose:z.enum(["facts","style","image"]),source:z.string().trim().max(1000),note:z.string().trim().max(4000).default("")});
export const articleReference=z.object({id:z.string().uuid(),version:z.number().int().positive(),method:z.string().trim().max(600).default("")});
export const briefAdjustments=z.object({goal:z.string().trim().max(240).optional(),audience:z.string().trim().max(300).optional(),images:z.boolean().optional()});
export const singleBrief=z.object({note:z.string().max(12000).default(""),adjust:briefAdjustments.default({}),materials:z.array(materialUse).max(12).default([]),articleRefs:z.array(articleReference).max(5).default([]),failed:z.array(z.object({name:z.string().max(180),error:z.string().max(400),required:z.boolean()})).max(12).default([])});
export type SingleBrief=z.infer<typeof singleBrief>;

function lastValue(text:string,pattern:RegExp){return Array.from(text.matchAll(pattern)).at(-1)?.[1]?.trim();}
export function resolveBrief(input:SingleBrief,defaults:{goal:string;audience:string;imagesRequired:boolean}){
  const text=input.note;
  const goal=lastValue(text,/(?:^|[\n，,；;。！？])\s*(?:(?:内容|创作)?目标[是：:]|希望达到[：:])\s*([^\n，,；;。！？]+)/gu);
  const audience=lastValue(text,/(?:^|[\n，,；;。！？])\s*(?:(?:目标)?受众[是：:]|写给|给谁看[：:])\s*([^\n，,；;。！？]+)/gu);
  const style=lastValue(text,/(?:^|[\n，,；;。！？])\s*(?:写法|语气|风格)[是：:]\s*([^\n，,；;。！？]+)/gu);
  const imageMention=Array.from(text.matchAll(/((?:不需要|不必|不用|不要|无需|需要|请加|加上)\s*(?:手动)?配图)/gu)).at(-1)?.[1];
  return {goal:input.adjust.goal??goal??defaults.goal,audience:input.adjust.audience??audience??defaults.audience,
    imagesRequired:input.adjust.images??(imageMention?!/^(?:不|无)/u.test(imageMention):defaults.imagesRequired),style,
    explicitImageRefusal:!!imageMention&&/^(?:不|无)/u.test(imageMention)};
}

export function materialConflicts(items:{source:string;text:string}[]){
  const facts=new Map<string,Map<string,Set<string>>>();
  for(const item of items)for(const match of item.text.matchAll(/(?:^|[\n；;。])\s*(活动日期|活动时间|报名截止|活动地点|产品价格|报名费用)[：:]\s*([^\n；;。]+)/gu)){
    const key=match[1],value=match[2].trim();
    const choices=facts.get(key)??new Map<string,Set<string>>();
    const sources=choices.get(value)??new Set<string>();
    sources.add(item.source);choices.set(value,sources);facts.set(key,choices);
  }
  return Array.from(facts).filter(([,choices])=>choices.size>1).map(([key,choices])=>key+"有冲突（"+
    Array.from(choices,([value,sources])=>value+"／"+Array.from(sources).join("、")).join("；")+"）。请保留适用的来源，或把其他材料改为参考写法。");
}

export function briefSuggestions(input:SingleBrief){
  const note=input.note;
  if(/(?:不(?:要|用|必|需|加)|别|禁止).{0,8}(?:任何(?:补充|建议)|额外说明|扩写)|只(?:写|输出|保留)|逐字/u.test(note))return [];
  return [
    !/结尾|互动|提问|不(?:要|用|添加|增加).{0,12}(?:额外|内容|说明)/u.test(note)&&{key:"ending",label:"收尾前检查是否需要一句可供读者回应的问题"},
    !/标题|不(?:要|用|添加|增加).{0,12}(?:额外|内容|说明)/u.test(note)&&{key:"title",label:"定稿前留一个备用标题"},
  ].filter((item):item is {key:string;label:string}=>Boolean(item));
}
