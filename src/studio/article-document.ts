import {z} from "zod";

// v1: title is separate. Blocks are joined by one LF; leaves concatenate.
// List markers and formatting are visual only. No trimming or Unicode normalization.
export const documentSchema=z.array(z.object({
  type:z.enum(["p","h1","h2","blockquote","li"]),
  children:z.array(z.object({text:z.string(),bold:z.boolean().optional()}).strict()).min(1)
}).strict()).min(1).max(10000);
export type ArticleDocument=z.infer<typeof documentSchema>;
export function fromText(body:string):ArticleDocument{
  return body.split("\n").map(text=>({type:"p",children:[{text}]}));
}
export function plainText(document:ArticleDocument){
  return document.map(block=>block.children.map(leaf=>leaf.text).join("")).join("\n");
}
export function quoteRange(document:ArticleDocument,quote:string,offset:number){
  if(!quote || !Number.isInteger(offset) || offset<0 || plainText(document).slice(offset,offset+quote.length)!==quote)return null;
  function point(target:number){
    let cursor=0;
    for(let b=0;b<document.length;b++){
      for(let l=0;l<document[b].children.length;l++){
        const size=document[b].children[l].text.length;
        if(target<=cursor+size)return {path:[b,l],offset:target-cursor};
        cursor+=size;
      }
      cursor++;
    }
    return null;
  }
  const anchor=point(offset),focus=point(offset+quote.length);
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
