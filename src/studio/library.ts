import {feishuMethods} from "./feishu";
import { DatabaseSync } from "node:sqlite";
import {createHash} from "node:crypto";
import {z} from "zod";
import {retrieve,fuse,SEMANTIC_THRESHOLD,type Chunk,type Hit,type Mode} from "../rag/search";
import {embed,cosine,MODEL} from "../rag/embedding";

export const formats=z.enum(["图文文章","口播稿","短视频脚本"]);
const line=z.string().trim().min(1).max(2000);
const labels=z.array(line).min(1).max(20);
const identity={id:z.string().regex(/^[a-z0-9-]{1,64}$/),version:z.number().int().positive(),source:line,
  rights:z.enum(["原创","已获许可"]),createdAt:z.iso.datetime(),allowExternal:z.boolean()};
export const referenceCase=z.object({...identity,title:line,content:line,format:formats,goal:line,tags:labels,
  method:line,applies:line,avoid:line,quality:labels,facts:z.string().max(2000).optional(),synthetic:z.boolean().optional()}).strict();
export const evaluationCase=z.object({...identity,content:line,referenceId:line.optional(),label:z.enum(["优秀","普通","不合格"]),
  reviewer:line,dimensions:labels,rationale:line,locations:z.array(line),positiveExample:z.string(),negativeExample:z.string(),scenario:line,tags:labels,
  format:formats.optional(),goal:line.optional(),split:z.enum(["pool","dev","holdout"]).optional(),synthetic:z.boolean().optional(),
  reviewedAt:z.iso.datetime().optional(),suggestion:z.string().max(2000).optional(),aiSuggestion:z.string().max(2000).optional(),
  issues:z.array(z.object({offset:z.number().int().nonnegative(),quote:line,severe:z.boolean()})).max(50).optional()
}).strict().refine(c=>c.issues?.every(i=>c.content.slice(i.offset,i.offset+i.quote.length)===i.quote)??true,"问题位置与原文不符");
export interface FutureSourceBinding {kind:"industry"|"company"|"brand"|"account";workspaceId:string;collectionId:string;version:number}
export const genericProfile={workspaceId:"general",bindings:[] as FutureSourceBinding[]};
const base={version:1,synthetic:true,source:"工作台原创虚构样例",rights:"原创",createdAt:"2026-11-02T00:00:00Z",allowExternal:false};
const samples=[
  {...base,id:"scene-editing",allowExternal:true,title:"从一句空话开始修改",content:"原创练习：把抽象评价改成读者能看见的一步动作。",format:"图文文章",goal:"解释表达",tags:["具体场景","自然表达"],method:"并列展示一句抽象判断与一个虚构动作，再指出读者能从动作中判断什么。",applies:"表达技巧、写作修改",avoid:"借用未经核实的效果数据",quality:["方法示例"]},
  {...base,id:"travel-conflict",title:"雨天车站的两张路线图",content:"旅客站在两张路线图之间，一张标距离，一张标楼梯。她拖着箱子，先看楼梯。",format:"图文文章",goal:"解释选择",tags:["场景冲突","产品价值"],method:"把两种方案放在同一具体处境中，用选择标准的变化解释价值。",applies:"方案比较、产品选择",avoid:"未经验证的性能承诺",quality:["正面示例"]},
  {...base,id:"kitchen-hook",title:"先听声音，再揭开锅盖",content:"开头只听见勺子刮过锅底，再问听众猜是哪一步做早了。",format:"口播稿",goal:"引发好奇",tags:["开头钩子","悬念"],method:"先给一个可感知的线索，提出一个具体问题，再解释问题。",applies:"教程、知识分享",avoid:"依赖专业安全结论的指导",quality:["正面示例"]},
  {...base,id:"craft-turn",title:"最后一格空白",content:"镜头扫过贴满标签的抽屉，唯独一格空着。下一镜才揭示它留给还没完成的作品。",format:"短视频脚本",goal:"塑造人物",tags:["反转","视觉叙事"],method:"用物件建立观众预期，通过下一镜的行动修正预期。",applies:"人物短片、工作过程",avoid:"抽象观点的严密论证",quality:["正面示例"]},
  {...base,id:"retail-counter",title:"只有赞美词的橱窗",content:"橱窗上只写着惊艳、非凡、卓越。路人看完，仍不知道里面卖什么。",format:"图文文章",goal:"改进表达",tags:["反面表达","产品价值"],method:"反例：连续形容词留下信息缺口。改写时以可见动作代替评价。",applies:"营销文案修改",avoid:"把反例当作推荐模板",quality:["反面示例"]}
].map(s=>referenceCase.parse(s));

function open(){
  const db=new DatabaseSync(process.env.STUDIO_LIBRARY_DB??"data/content-library.sqlite");
  db.exec("CREATE TABLE IF NOT EXISTS reference_cases(id TEXT,version INTEGER,payload TEXT,PRIMARY KEY(id,version)); CREATE TABLE IF NOT EXISTS eval_cases(id TEXT,version INTEGER,payload TEXT,PRIMARY KEY(id,version))");
  db.exec("CREATE TABLE IF NOT EXISTS removed_references(id TEXT PRIMARY KEY, version INTEGER NOT NULL)");
  return db;
}
export function references():z.infer<typeof referenceCase>[]{
  const db=open();
  try{
    const imported=db.prepare("SELECT payload FROM reference_cases ORDER BY version").all().map(r=>referenceCase.parse(JSON.parse(String(r.payload))));
    const removed=new Set(db.prepare("SELECT id FROM removed_references").all().map(r=>r.id));
    return [...new Map([...samples,...imported,...feishuMethods()].map(c=>[c.id,c])).values()].filter(c=>!removed.has(c.id));
  }finally{db.close();}
}
export function importCase(input:unknown,purpose:"reference"|"evaluation"){
  const item=(purpose==="reference"?referenceCase:evaluationCase).parse(input);
  const db=open();
  try{
    db.exec("BEGIN IMMEDIATE");
    const table=purpose==="reference"?"reference_cases":"eval_cases";
    const previous=db.prepare("SELECT version,payload FROM "+table+" WHERE id=? ORDER BY version DESC LIMIT 1").get(item.id);
    const builtin=purpose==="reference"?samples.find(s=>s.id===item.id):undefined;
    if(item.version!==Number(previous?.version??builtin?.version??0)+1)throw Error("版本冲突");
    if(purpose==="reference" && db.prepare("SELECT id FROM removed_references WHERE id=?").get(item.id))throw Error("案例已删除");
    if(purpose==="evaluation"){
      const entry=evaluationCase.parse(item);
      const split=entry.split??"dev";
      for(const row of db.prepare("SELECT payload FROM eval_cases").all()){
        const other=evaluationCase.parse(JSON.parse(String(row.payload)));
        if(other.split!=="pool" && (other.split??"dev")!==split && (other.id===entry.id || other.content.trim()===entry.content.trim() || (entry.referenceId && entry.referenceId===other.referenceId)))
          throw Error("同一案例不能跨开发与验收集");
      }
    }
    db.prepare("INSERT INTO "+table+" VALUES(?,?,?)").run(item.id,item.version,JSON.stringify(item));
    db.exec("COMMIT");
  }
  finally{db.close();}
  return item;
}
export function removeReference(id:string,version:number){
  const db=open();
  try{
    db.exec("BEGIN IMMEDIATE");
    const current=db.prepare("SELECT MAX(version) AS version FROM reference_cases WHERE id=?").get(id)?.version
      ??samples.find(c=>c.id===id)?.version;
    if(current!==version)throw Error("案例已变化");
    db.prepare("INSERT INTO removed_references VALUES(?,?)").run(id,version);
    db.exec("COMMIT");
  }finally{db.close();}
}
export function evaluations(){
  const db=open();
  try{return db.prepare("SELECT payload FROM eval_cases ORDER BY id,version").all().map(r=>evaluationCase.parse(JSON.parse(String(r.payload))));}
  finally{db.close();}
}
// These projections are the only dataset reads used while building Eval prompts.
export function blindSample(id:string,version:number){
  const db=open();
  try{
    const row=db.prepare(`SELECT id, version,
      json_extract(payload,'$.content') AS content,json_extract(payload,'$.goal') AS goal,
      json_extract(payload,'$.format') AS format FROM eval_cases
      WHERE id=? AND version=? AND coalesce(json_extract(payload,'$.split'),'dev')!='pool'`).get(id,version);
    return row && z.object({id:z.string(),version:z.number(),content:z.string(),goal:z.string().nullable(),format:formats.nullable()}).parse(row);
  }finally{db.close();}
}
export function developmentCalibration(body:string,excludeId:string){
  const db=open();
  try{
    return db.prepare(`SELECT c.id,c.version,json_extract(c.payload,'$.label') AS label,
      json_extract(c.payload,'$.dimensions') AS dimensions,json_extract(c.payload,'$.rationale') AS rationale
      FROM eval_cases c WHERE coalesce(json_extract(c.payload,'$.split'),'dev')='dev'
      AND c.id!=? AND json_extract(c.payload,'$.content')!=?
      AND c.version=(SELECT max(v.version) FROM eval_cases v WHERE v.id=c.id)
      ORDER BY c.rowid DESC LIMIT 4`).all(excludeId,body).map(r=>({
        id:String(r.id),version:Number(r.version),label:String(r.label),dimensions:JSON.parse(String(r.dimensions)) as string[],rationale:String(r.rationale)
      }));
  }finally{db.close();}
}
export function benchmark(){
  const latest=[...new Map(evaluations().map(e=>[e.id,e])).values()];
  return {inputs:latest.filter(e=>e.split!=="pool").map(e=>({id:e.id,version:e.version,split:e.split??"dev",content:e.content,format:e.format,goal:e.goal,
    criteria:["内容策略","表达质量","内容结构","基础规范"]})),
    distribution:["dev","holdout","pool"].map(split=>{
      const rows=latest.filter(e=>(e.split??"dev")===split);
      return {split,count:rows.length,labels:Object.fromEntries(["优秀","普通","不合格"].map(label=>[label,rows.filter(e=>e.label===label).length]))};
    })};
}
type Preferences={topic:string;format?:string;goal?:string;style?:string;audience:string};
const rule="参考库只提供创作技法。禁止沿用案例中的人物、经历、产品参数或效果作为事实。缺少事实依据须保留缺口。";
const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
export function generalContext(input:Preferences){
  const compiledContext=rule+"\n"+JSON.stringify({topic:input.topic,format:input.format,audience:input.audience,goal:input.goal,style:input.style});
  return {compiledContext,manifest:{version:"general-v1",assemblyHash:digest(compiledContext),conflicts:[],loadedModules:[{path:"general/rules",sha256:digest(rule)}]}};
}
export function methodIndex(externalOnly=false,selected?:string[]){
  const rows=references();
  for(const pin of selected??[]){
    if(pin.includes("@")&&!rows.some(c=>c.id+"@"+c.version===pin))throw Error("指定参考版本已失效，请返回资料库重新选择。");
  }
  const chunks:Chunk[]=rows.filter(c=>(!externalOnly||c.allowExternal)&&(!selected||selected.includes(c.id)||selected.includes(c.id+"@"+c.version))).map(c=>{
    const path="general/reference/"+c.id+"/v"+c.version;
    const text=[c.method,"适用："+c.applies,"不适用："+c.avoid].join("\n");
    return {id:path,path,sha256:digest(JSON.stringify(c)),heading:c.tags.join(" / "),location:"创作方法",offset:0,text,
      persona:"shared",personaReason:"general 独立资料库",kind:"expression-rule",kindReason:"创作技法参考，不能作为事实依据",
      verified:false,publicationDate:null,tags:[c.format,c.goal,...c.tags],sources:[{path:c.source,modifiedAt:Date.parse(c.createdAt),associatedPersonas:[]}],
      temporal:{status:"unknown",publicationDate:c.createdAt,applicableDate:"仅借鉴方法",dateMentions:[],reason:"未经事实核验"}};
  });
  return {chunks,files:chunks.map(c=>({path:c.path,status:"indexed",chunks:1}))};
}
export async function findMethods(input:Preferences,query:string,mode:Mode,index:{chunks:Chunk[]}=methodIndex()){
  const start=performance.now();
  const terms=[query,input.goal,input.style,input.audience].filter(Boolean).join(" ");
  const base=retrieve(index.chunks,terms,"shared",20);
  let hits=base.hits;
  if(mode!=="keyword"){
    const q=await embed(terms,true);
    const scored=await Promise.all(index.chunks.map(async c=>({...c,similarity:cosine(q,await embed([c.heading,...c.tags,c.text].join(" ")))})));
    const semantic:Hit[]=scored.filter(c=>c.similarity>=SEMANTIC_THRESHOLD).sort((a,b)=>b.similarity-a.similarity)
      .map((c,i)=>({...c,score:c.similarity,semanticRank:i+1,finalRank:i+1}));
    hits=mode==="semantic"?semantic:fuse(hits,semantic);
  }
  // Rank candidates using explicit creative facets as well as retrieval rank.
  const score=(c:Chunk)=>c.tags.reduce((n,t)=>n+(t===input.format?1:terms.includes(t)?3:0),0);
  const ranked=index.chunks.map(c=>{
    const h=hits.find(h=>h.id===c.id);
    return {...c,...h,score:score(c)+(h?2/h.finalRank:0),finalRank:0};
  }).filter(c=>c.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,5).map((c,i)=>({...c,finalRank:i+1}));
  return {...base,mode,hits:ranked,model:mode==="keyword"?null:MODEL,elapsedMs:performance.now()-start,
    scoreMeaning:"检索排名与形式、目标、技法匹配加权",warnings:[rule,...(!ranked.length?["没有匹配的创作参考"]:[])]};
}


