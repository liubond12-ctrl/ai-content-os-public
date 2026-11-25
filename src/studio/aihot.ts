import {DatabaseSync} from "node:sqlite";
import {z} from "zod";
const web=z.url({protocol:/^https?$/});
export const categories:Record<string,string>={"ai-models":"AI 模型","ai-products":"AI 产品",industry:"行业动态",paper:"论文",tip:"教程",opinion:"观点"};
const raw=z.object({rank:z.number().optional(),sourceCount:z.number().optional(),sourceNames:z.array(z.string()).optional(),category:z.string().optional(),id:z.string().optional(),date:z.string().optional(),title:z.string().optional(),leadTitle:z.string().optional(),summary:z.string().optional(),leadParagraph:z.string().optional(),latestAt:z.string().optional(),publishedAt:z.string().optional(),generatedAt:z.string().optional(),source:z.object({name:z.string()}).optional(),links:z.object({aihot:web,original:web.optional(),story:web.optional()})});
export interface HotItem {key:string;title:string;summary:string;date:string;source:string;canonical:string;original:string;story:string;rank?:number;sourceCount?:number;sourceNames?:string[];category?:string}
export function normalize(value:unknown):HotItem[]{
  const {items}=z.object({items:z.array(raw)}).parse(value);
  const unique=new Map<string,HotItem>();
  for(const r of items){
    const key=r.links.story||r.links.aihot,title=r.title||r.leadTitle;
    if(!title||unique.has(key))continue;
    unique.set(key,{key,title,summary:r.summary||r.leadParagraph||"",date:r.publishedAt||r.latestAt||r.generatedAt||"",source:r.source?.name||"AIHOT",canonical:r.links.aihot,original:r.links.original||r.links.aihot,story:r.links.story||"",rank:r.rank,sourceCount:r.sourceCount,sourceNames:r.sourceNames,category:r.category});
  }
  return [...unique.values()];
}
const paths={latest:"items?mode=selected&window=24h&limit=20",events:"hot-topics",daily:"dailies?limit=5"};
export type Section=keyof typeof paths;
type Feed={cursor?:string;items:HotItem[];time:number;error:string};
type Entry={feed:Feed;etag:string;next:number};
const cache=new Map<string,Entry>(),pending=new Map<string,Promise<Feed>>();
let cooldown=0;
export async function readFeed(section:Section,story="",options:{all?:boolean;category?:string;cursor?:string}={}):Promise<Feed>{
  if(story&&!/^[a-zA-Z0-9_-]{1,100}$/.test(story))throw Error("事件标识无效");
  if(process.env.STUDIO_DEMO_INSTANCE==="1"){
    const local=process.env.STUDIO_WORKER_URL??"http://127.0.0.1:3588";
    return {items:normalize({items:[{title:"离线样例 · 从纸角动作观察写法",summary:"模拟热点来源，适合练习选题转换。",source:{name:"本机模拟"},
      links:{aihot:new URL("/hot?fixture=paper",local).href}}]}),time:Date.now(),error:""};
  }
  const query=new URLSearchParams({mode:options.all?"all":"selected",window:"7d",by:"published",limit:"20"});
  if(options.category&&Object.hasOwn(categories,options.category))query.set("category",options.category);
  if(options.cursor)query.set("cursor",options.cursor.slice(0,2000));
  const path=story?"stories/"+story:section==="latest"?"items?"+query:paths[section],prior=cache.get(path);
  if(prior&&Date.now()<prior.next)return prior.feed;
  if(Date.now()<cooldown)return {...(prior?.feed||{items:[],time:0}),error:"上游限流，请稍后重试"};
  const inflight=pending.get(path);if(inflight)return inflight;
  const promise=(async()=>{
    const now=Date.now();
    try{
      const r=await fetch("https://aihot.news/api/v1/"+path,{headers:{"User-Agent":"PersonalContentWorkbench/1.0",...(prior?.etag?{"If-None-Match":prior.etag}:{})},cache:"no-store",signal:AbortSignal.timeout(9000)});
      if(r.status===429||r.status===503){
        const retry=r.headers.get("retry-after")||"300";
        cooldown=now+Math.max(60000,/^\d+$/.test(retry)?Number(retry)*1000:(Date.parse(retry)||now+300000)-now);
      }
      if(r.status===404||r.status===410||r.status===403)cache.delete(path);
      if(r.status!==304&&!r.ok)throw Error("上游 HTTP "+r.status);
      let items=prior?.feed.items||[],cursor=prior?.feed.cursor;
      if(r.status!==304){const data=await r.json();items=normalize(story?{items:data.story?.reports}:data);cursor=data.page?.hasMore&&typeof data.page.nextCursor==="string"?data.page.nextCursor:undefined;}
      const ttl=Math.max(300,Number(r.headers.get("cache-control")?.match(/(?:^|,\s*)max-age=(\d+)/)?.[1]||0));
      const feed={items,cursor,time:now,error:""};
      cache.set(path,{feed,etag:r.headers.get("etag")||prior?.etag||"",next:now+ttl*1000});return feed;
    }catch{
      const saved=cache.get(path);
      const feed={items:saved?.feed.items||[],time:saved?.feed.time||0,error:"暂时无法确认最新内容"};
      cache.set(path,{feed,etag:saved?.etag||"",next:Math.max(now+60000,cooldown)});return feed;
    }finally{pending.delete(path);}
  })();pending.set(path,promise);
  if(cache.size>64)cache.delete(cache.keys().next().value!);
  return promise;
}
export function hotDb(){
  const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
  db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS hot_read(key TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS hot_saved(key TEXT PRIMARY KEY,title TEXT,original TEXT,source TEXT,note TEXT,updated TEXT); CREATE TABLE IF NOT EXISTS hot_saved_source(key TEXT PRIMARY KEY,canonical TEXT,published TEXT)");
  return db;
}
export function savedHot(q:string){
  const db=hotDb();try{return db.prepare("SELECT s.*,c.canonical,c.published FROM hot_saved s LEFT JOIN hot_saved_source c USING(key) WHERE instr(title,?) OR instr(note,?) OR instr(source,?) OR instr(original,?) ORDER BY updated DESC,key LIMIT 100").all(q,q,q,q);}finally{db.close();}
}
