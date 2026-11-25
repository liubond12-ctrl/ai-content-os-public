import {z} from "zod";

export const imagePlatform=z.enum(["小红书","抖音","公众号"]);
export type ImagePlatform=z.infer<typeof imagePlatform>;
export type StoryboardCard={
  task:string; articleVersion:number; slot:number; platform:ImagePlatform;
  ratio:"3:4"|"9:16"|"2.35:1"; description:string; overlayText:string; prompt:string;
};
export const sectionKey=z.string().regex(/^[a-zA-Z0-9:_-]{1,100}$/);
export const chapterPlan=z.object({id:sectionKey,heading:z.string().trim().min(1).max(120).refine(text=>!/[\r\n]/.test(text))}).strict();
export type ChapterPlan=z.infer<typeof chapterPlan>;
export const chapterOutput=z.object({paragraphs:z.array(z.object({text:z.string().trim().min(1).max(8000).refine(text=>!/[\r\n]/.test(text)&&!text.startsWith("#")),
  sources:z.array(z.string().max(300)).max(12)}).strict()).min(1).max(15)}).strict();
export type ChapterOutput=z.infer<typeof chapterOutput>;
export type ChapterRecord=ChapterPlan&ChapterOutput;
export type MatrixMatch={id:string;title:string;account:string;state:string;signals:string[];href:string};
export type GeoItem={label:string;met:boolean;advice:string};
export type AssemblyTrace={account:string;accountVersion:number;hash:string;modules:{source:string;hash:string;duplicateOf?:string}[];
  conflicts:{key:string;sources:string[];resolution:string}[];references:string[]};
