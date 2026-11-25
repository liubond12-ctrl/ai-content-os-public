import {z} from "zod";
import {sectionNames} from "./production-schema";
import {sectionKey,type ChapterRecord} from "../types/sprint5";

// v1: title is separate. Blocks are joined by one LF; leaves concatenate.
// List markers and formatting are visual only. No trimming or Unicode normalization.
export const documentSchema=z.array(z.object({
  type:z.enum(["p","h1","h2","blockquote","li"]),
  blockId:sectionKey.optional(),sectionId:sectionKey.optional(),
  children:z.array(z.object({text:z.string(),bold:z.boolean().optional()}).strict()).min(1)
}).strict()).min(1).max(10000);
export type ArticleDocument=z.infer<typeof documentSchema>;
export function fromText(body:string):ArticleDocument{
  return body.split("\n").map(text=>({type:"p",children:[{text}]}));
}
export function plainText(document:ArticleDocument){
  return document.map(block=>block.children.map(leaf=>leaf.text).join("")).join("\n");
}
export function chapterDocument(body:string,chapters:ChapterRecord[]):ArticleDocument{
  let section:string|undefined,offset=0;
  const titles=new Map(chapters.map(chapter=>["### "+chapter.heading,chapter.id]));
  return fromText(body).map(block=>{
    const heading=titles.get(plainText([block]));
    if(heading){section=heading;offset=0;}
    else if(/^## /.test(plainText([block]))){section=undefined;}
    return section?{...block,...(heading?{type:"h2" as const}:{}),sectionId:section,blockId:section+":"+offset++}:block;
  });
}
export function stabilizeBlocks(document:ArticleDocument,previous:ArticleDocument):ArticleDocument{
  const exists=new Set(previous.flatMap(block=>block.blockId?[block.blockId]:[]));
  if(!exists.size)return document;
  const used=new Set<string>();
  let sectionId:string|undefined;
  return document.map(block=>{
    const text=plainText([block]);
    if(/^## /.test(text))sectionId=undefined;
    else if(block.sectionId)sectionId=block.sectionId;
    if(!sectionId)return block;
    const id=block.blockId&&!used.has(block.blockId)?block.blockId:crypto.randomUUID();
    used.add(id);
    return {...block,sectionId,blockId:id};
  });
}
export function bodySection(document:ArticleDocument,kind?:keyof typeof sectionNames){
  if(!kind)return {start:0,end:document.length};
  const name=kind==="口播稿"?"口播正文":kind==="分镜脚本"?"口播或对白":"正文";
  const headings=document.map((block,index)=>{
    const text=plainText([block]).trim();
    const heading=text.startsWith("## ")?text.slice(3):block.type==="h2"?text:"";
    return sectionNames[kind].includes(heading)?{name:heading,index}:null;
  }).filter(heading=>heading!==null);
  const found=headings.filter(heading=>heading.name===name);
  if(found.length!==1)return null;
  const header=found[0].index;
  return {start:header+1,end:headings.find(heading=>heading.index>header)?.index??document.length};
}
export function mapReviewAnchor(original:string,live:string,quote:string,offset:number){
  if(!quote||!Number.isInteger(offset)||offset<0||original.slice(offset,offset+quote.length)!==quote)return null;
  if(original===live)return offset;
  const match=live.indexOf(quote);
  if(match<0)return null;
  if(original.indexOf(quote)===original.lastIndexOf(quote)&&match===live.lastIndexOf(quote))return match;
  const start=Math.max(0,offset-24);
  const context=original.slice(start,offset+quote.length+24);
  const at=live.indexOf(context);
  return at>=0&&at===live.lastIndexOf(context)&&original.indexOf(context)===original.lastIndexOf(context)?at+offset-start:null;
}
export function quoteRange(document:ArticleDocument,quote:string,offset:number){
  if(!quote || !Number.isInteger(offset) || offset<0 || plainText(document).slice(offset,offset+quote.length)!==quote)return null;
  function point(target:number,start:boolean){
    let cursor=0;
    for(let b=0;b<document.length;b++){
      for(let l=0;l<document[b].children.length;l++){
        const size=document[b].children[l].text.length;
        if(target<cursor+size||target===cursor+size&&(!start||l===document[b].children.length-1))return {path:[b,l],offset:target-cursor};
        cursor+=size;
      }
      cursor++;
    }
    return null;
  }
  const anchor=point(offset,true),focus=point(offset+quote.length,false);
  return anchor&&focus?{anchor,focus}:null;
}
// Bounded linear comparison, not a semantic or formatting diff.
export function textDiff(before:string,after:string){
  const a=Array.from(before),b=Array.from(after);
  let start=0,end=0;
  while(start<a.length&&start<b.length&&a[start]===b[start])start++;
  while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;
  return {prefix:a.slice(0,start).join(""),removed:a.slice(start,a.length-end).join(""),added:b.slice(start,b.length-end).join(""),suffix:end?a.slice(-end).join(""):""};
}
