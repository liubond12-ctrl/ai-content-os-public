import {cloudEnabled,inputHash} from "./production-cloud";
import type {CallRecord} from "./usage";
import {randomUUID,createHash} from "node:crypto";
import {z} from "zod";
import {productionDb,entities,event} from "./production-db";
import {brief,type Task,advance,lookup} from "./tasks";
import {references,methodIndex} from "./library";
import {contentKind,productionPlatform,ruleSnapshot} from "./production-schema";
import {flow,control,tick,type Flow} from "./collaboration";
import {productionBudget} from "./production-schema";
import {readArticles} from "./article-store";
import {briefSuggestions,materialConflicts,resolveBrief,singleBrief} from "./single-brief";
import {autopilotHopState,hopHandoff,linkAutopilotTask,reserveAutopilotHop} from "./autopilot-guard";
import type {CruiseMaterial} from "../types/autopilot";
import {brickPin} from "../types/calibration";
import {freezeBricks} from "./atomic-bricks";
import {matrixMatches} from "./matrix";
import {chapterPlan} from "../types/sprint5";
import {seriesKey} from "../types/readiness";
import {claimSeries,seriesSources} from "./production-series";

const line=z.string().trim().max(4000);
export const entitySchema=z.object({
  id:z.string().default(""),version:z.number().int().nonnegative().default(0),brand:z.literal("default").default("default"),
  name:line.min(1),body:line.default(""),audience:line.default(""),platform:productionPlatform.default(""),
  sources:z.array(z.string()).default([]),rules:z.array(z.string()).default([]),
  status:z.enum(["草稿","启用","停用","归档"]).default("草稿"),
  account:z.string().default(""),goal:z.string().default(""),type:z.string().default(""),
  hard:z.boolean().default(false),constraintKey:line.transform(v=>v.normalize("NFKC").replace(/\s+/g,"").toLowerCase()).default(""),constraintValue:line.default(""),
  writingPreference:z.string().trim().max(600).optional(),
});
export type Entity=z.infer<typeof entitySchema>;
export const draftSchema=z.object({
  intent:z.enum(["draft","queued"]).default("draft"),id:z.uuid(),version:z.number().int().nonnegative(),account:z.string().default(""),
  platform:productionPlatform.default(""),topic:line.max(240),goal:z.enum(["获客","品宣","自由表达"]).default("品宣"),
  budgetProfile:z.enum(["protected","local_extended","cloud_review"]).default("protected"),
  kind:contentKind,requirements:line.default(""),outline:line.default(""),audience:line.default(""),
  sources:z.array(z.string()).default([]),assets:z.array(z.uuid()).default([]),imagesRequired:z.boolean().default(false),
  brief:singleBrief.optional(),bricks:z.array(brickPin).max(8).optional(),experiment:z.string().trim().max(240).optional(),
  chapters:z.array(chapterPlan).min(2).max(6).refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length&&new Set(rows.map(row=>row.heading)).size===rows.length,"章节标题和标识必须唯一").optional(),
  plannedDay:z.iso.date().optional(),
  series:seriesKey.optional(),
});
export type ProductionDraft=z.infer<typeof draftSchema>;
type Snapshot=z.infer<typeof ruleSnapshot>;
function snapshots(all:Entity[],draft:Omit<ProductionDraft,"goal">&{goal:string},account:Entity|undefined){
  const rules=all.filter(r=>r.status==="启用"&&(!r.account||r.account===draft.account)&&(!r.platform||r.platform===draft.platform)&&(!r.goal||r.goal===draft.goal)&&(!r.type||r.type===draft.kind));
  for(const id of account?.rules??[])if(!rules.some(r=>r.id===id))throw Error("账号关联的规范已停用或范围不匹配，请修改账号配置后重新预检");
  const hard=new Map<string,string>();
  for(const r of rules){
    if(r.hard&&r.constraintKey){
      if(hard.has(r.constraintKey)&&hard.get(r.constraintKey)!==r.constraintValue)throw Error("硬要求冲突："+r.constraintKey+"。请先修改规范。");
      hard.set(r.constraintKey,r.constraintValue);
    }
  }
  return rules.map(r=>({id:r.id,version:r.version,name:r.name,body:r.body,hard:r.hard,hash:createHash("sha256").update(r.body).digest("hex"),reason:[r.account?"账号":"通用",r.platform,r.goal,r.type].filter(Boolean).join(" / "),
    ...(r.constraintKey?{constraint:{key:r.constraintKey,value:r.constraintValue}}:{})})) satisfies Snapshot[];
}
export function previewDraft(draft:ProductionDraft){
  const db=productionDb();
  try{
    const accounts:Entity[]=entities(db,"account");
    const account=accounts.find(a=>a.id===draft.account&&a.status==="启用");
    const problems=[!draft.topic.trim()&&"请填写选题",(draft.kind!=="自由文章"||draft.account)&&!account&&"请选择启用的账号",draft.kind!=="自由文章"&&!draft.platform&&"请选择平台"];
    for(const failure of draft.brief?.failed??[])if(failure.required)problems.push("需要重新读取 "+failure.name+"（"+failure.error+"）");
    if(!draft.brief&&problems.some(Boolean))throw Error(problems.filter(Boolean).join("；"));
    try{methodIndex(cloudEnabled(),draft.sources);}catch(e){problems.push(e instanceof Error?e.message:"写作参考读取失败");}
    if(cloudEnabled()&&draft.sources.some(s=>!references().some(r=>r.id+"@"+r.version===s&&r.allowExternal)))problems.push("选中资料没有外发许可或版本已失效");
    if(cloudEnabled()&&!draft.sources.length&&(account||draft.kind==="自由文章"))problems.push("请在「引用稿件或资料」选择一条允许外发的写法参考");
    if(cloudEnabled()&&draft.assets.length)problems.push("请把旧附件从草稿中移除，需要时在统一输入区重新添加并核对发送范围");
    const attachments:Array<{id:string;name:string;source:string;text:string;purpose?:"facts"|"style"}>=draft.assets.map(id=>{
      const a=db.prepare("SELECT a.* FROM production_assets a LEFT JOIN production_material_owners o ON o.asset=a.id WHERE a.id=? AND a.brand='default' AND o.asset IS NULL").get(id);
      if(!a||!a.allowed)throw Error("附件缺少创作使用许可");
      return {id,name:String(a.name),source:String(a.source),text:a.mime==="text/plain"?Buffer.from(a.bytes as Uint8Array).toString("utf8"):String(a.description)};
    });
    const resolved=draft.brief&&resolveBrief(draft.brief,{...draft,audience:draft.audience||account?.audience||""});
    const illustrations:Array<{id:string;name:string;source:string}>=[];
    const reused:Array<{id:string;version:number;title:string}>=[];
    for(const item of draft.brief?.materials??[]){
      const a=db.prepare("SELECT a.* FROM production_assets a JOIN production_material_owners o ON o.asset=a.id WHERE a.id=? AND o.draft=? AND (o.account='' OR o.account=?)").get(item.id,draft.id,draft.account);
      if(!a||!a.allowed){problems.push(item.name+"的归属或使用许可已变化，请重新添加");continue;}
      const image=String(a.mime).startsWith("image/");
      if(!item.source){problems.push("请为 "+item.name+" 填写材料出处");continue;}
      if(item.purpose==="image"){
        if(!image){problems.push(item.name+" 是文本，请更改材料用途");continue;}
        illustrations.push({id:item.id,name:String(a.name),source:item.source});continue;
      }
      const material=image?item.note:Buffer.from(a.bytes as Uint8Array).toString("utf8");
      if(!material.trim()){problems.push(item.name+" 没有可读文本，请粘贴截图文字或改为只作配图");continue;}
      attachments.push({id:item.id,name:String(a.name),text:material,source:item.source,purpose:item.purpose});
    }
    for(const ref of draft.brief?.articleRefs??[]){
      const t=lookup(ref.id);
      if(!account||t?.input.production?.account!==account.id){problems.push("有稿件参考不属于当前账号，请重新选择");continue;}
      const article=readArticles(ref.id).versions.find(v=>v.version===ref.version);
      if(!article||!ref.method){problems.push("请说明希望借鉴该稿的哪种写法");continue;}
      reused.push({id:ref.id,version:ref.version,title:article.title});
      // Send only the author's method description, never the referenced article body or title.
      attachments.push({id:"article-method/"+ref.id+"/"+ref.version,name:"作者指定写法",source:"本账号稿件写法（正文未发送）",text:ref.method,purpose:"style"});
    }
    if(draft.brief){
      problems.push(...materialConflicts([{source:"本次创作说明",text:draft.brief.note},...attachments.filter(a=>a.purpose==="facts")]));
      if(cloudEnabled()&&attachments.reduce((sum,a)=>sum+a.text.length,0)>16000)problems.push("云端预检每篇最多接收 16,000 字材料，请保留相关片段");
      if(resolved&&(resolved.goal.length>240||resolved.audience.length>300))problems.push("推断出的目标或受众过长，请在预检前简化");
    }
    if(problems.some(Boolean))throw Error(problems.filter(Boolean).join("；"));
    const scoped={...draft,goal:resolved?.goal||draft.goal};
    if(cloudEnabled()&&draft.bricks?.length)throw Error("素材积木仅可提交给本机模型，请先移除积木");
    if(draft.chapters&&(cloudEnabled()||draft.kind!=="自由文章"&&draft.kind!=="图文"||draft.budgetProfile!=="local_extended"))throw Error("分章生成使用本机长文额度，支持图文或自由文章");
    if(draft.series&&cloudEnabled())throw Error("连载前序资料当前仅限本机装配");
    const preceding=seriesSources(db,draft.account,draft.series).slice(-5);
    const bricks=freezeBricks(db,draft.account,draft.bricks??[]);
    return {brand:"default" as const,account:account?.id??"",accountVersion:account?.version??0,accountName:account?.name??"未归属",accountDescription:account?.body??"",platform:draft.platform,kind:draft.kind,
      requirements:draft.requirements,outline:draft.outline,imagesRequired:resolved?.imagesRequired??draft.imagesRequired,attachments,
      ...(bricks.length?{bricks}:{}),
      ...(draft.chapters?{chapters:draft.chapters}:{}),
      ...(draft.plannedDay?{plannedDay:draft.plannedDay}:{}),
      ...(draft.series?{series:draft.series,seriesSources:preceding}:{}),
      ...(draft.brief?{authorBrief:draft.brief.note,writingPreference:account?.writingPreference||"",resolved,illustrations,reused}:{}),
      rules:snapshots(entities(db,"rule"),scoped,account),standards:snapshots(entities(db,"standard"),scoped,undefined),budget:productionBudget(draft.kind,cloudEnabled()?"cloud_review":draft.budgetProfile)};
  }finally{db.close();}
}
export const workerHeartbeatWindowMs=12000;
function modelConfigured(){
  return Boolean(process.env.STUDIO_MODEL&&(cloudEnabled()||/^http:\/\/127\.0\.0\.1(:\d+)?\//.test(process.env.STUDIO_MODEL_URL??"")));
}
export function productionView(configurationOnly=false,draftId=""){
  const db=productionDb();
  let accounts:Entity[],rules:Entity[],standards:Entity[],drafts:ProductionDraft[],queue,batches,workers,assets;
  let draftOrigin:HotOrigin|null=null;
  try{
    accounts=entities(db,"account");rules=entities(db,"rule");standards=entities(db,"standard");
    drafts=db.prepare("SELECT d.payload FROM production_drafts d JOIN production_draft_order o ON o.id=d.id ORDER BY o.position,d.rowid").all().map(r=>draftSchema.parse(JSON.parse(String(r.payload))));
    batches=configurationOnly?[]:db.prepare("SELECT * FROM production_batches ORDER BY created DESC").all().map(b=>{
      const calls:CallRecord[]=db.prepare("SELECT m.payload FROM model_calls m JOIN production_queue q ON q.task=m.task_id WHERE q.batch=?").all(b.id).map(r=>JSON.parse(String(r.payload)));
      return {id:String(b.id),created:String(b.created),version:Number(b.version),mode:String(b.mode),token_limit:Number(b.token_limit),request_limit:Number(b.request_limit),estimatedUsd:calls.reduce((n,c)=>n+(c.estimatedUsd??0),0),unpriced:calls.filter(c=>c.estimatedUsd===undefined).length,usedRequests:calls.length,knownTokens:calls.reduce((n,c)=>n+(c.usage==="unknown"?0:c.usage.total_tokens),0),reservedTokens:calls.reduce((n,c)=>n+(c.usage==="unknown"?(c.estimatedInput??0)+(c.reservedOutput??800):c.usage.total_tokens),0),unknownCalls:calls.filter(c=>c.usage==="unknown").length};
    });
    queue=configurationOnly?[]:db.prepare(`SELECT q.*,v.payload FROM production_queue q JOIN versions v ON v.id=q.task AND v.rev=(SELECT max(rev) FROM versions WHERE id=q.task) ORDER BY (SELECT created FROM production_batches WHERE id=q.batch),q.position`).all();
    if(draftId&&db.prepare("SELECT 1 FROM sqlite_master WHERE name='hot_origins'").get()){
      const row=db.prepare("SELECT title,source,original,canonical FROM hot_origins WHERE draft=? AND task IS NULL").get(draftId);
      if(row)draftOrigin={title:String(row.title),source:String(row.source),original:String(row.original),canonical:String(row.canonical)};
    }
    workers=db.prepare("SELECT * FROM production_workers ORDER BY seen DESC").all();
    assets=db.prepare("SELECT a.id,a.name,a.mime,a.description,a.source,a.allowed,a.created FROM production_assets a LEFT JOIN production_material_owners o ON o.asset=a.id WHERE a.brand='default' AND o.asset IS NULL ORDER BY a.created DESC").all();
  }finally{db.close();}
  return {modelConfigured:modelConfigured(),draftOrigin,workerOnline:workers.some(w=>Date.now()-Number(w.seen)<workerHeartbeatWindowMs),accounts,rules,standards,drafts,batches,workers,assets,references:references().filter(r=>!cloudEnabled()||r.allowExternal),mode:cloudEnabled()?"真实云端":process.env.STUDIO_DEMO_INSTANCE==="1"?"离线示例":"本机模型",
    queue:queue.map(q=>{
      const t:Task=JSON.parse(String(q.payload));let article;
      try{article=readArticles(t.id).head;}catch{}
      return {manual:t.article?.model==="manual",id:t.id,started:t.revision>0,batch:String(q.batch),position:Number(q.position),status:article?.confirmed?"已定稿":String(q.status),reason:String(q.reason??""),
        updated:String(q.updated),topic:t.input.topic,production:t.input.production,version:article?.version,confirmed:article?.confirmed??false,title:article?.title,excerpt:article?.body.slice(0,90)};
    })};
}
export type ProductionView=ReturnType<typeof productionView>;
export function saveEntity(kind:"account"|"rule"|"standard",raw:unknown){
  const value=entitySchema.parse(raw),db=productionDb();
  try{
    db.exec("BEGIN IMMEDIATE");
    const id=value.id||randomUUID();
    const old=db.prepare("SELECT max(version) AS version FROM production_entities WHERE kind=? AND id=?").get(kind,id);
    if(Number(old?.version??0)!==value.version)throw Error("配置已由其他窗口更新，请重新载入");
    if(value.hard&&(!value.constraintKey||!value.constraintValue))throw Error("硬要求需要填写冲突检查项与要求值");
    if(kind!=="account"&&value.status==="启用"&&!value.body.trim())throw Error("启用前请填写规范正文或质量判断说明");
    const next={...value,id,version:value.version+1};
    db.prepare("INSERT INTO production_entities VALUES(?,?,?,?)").run(kind,id,next.version,JSON.stringify(next));
    db.exec("COMMIT");return next;
  }finally{db.close();}
}
type HotOrigin={title:string;original:string;canonical:string;source:string};
function writeDraft(db:ReturnType<typeof productionDb>,value:ProductionDraft,origin?:HotOrigin){
  const old=db.prepare("SELECT version,payload FROM production_drafts WHERE id=?").get(value.id);
  if(Number(old?.version??0)!==value.version)throw Error("草稿已更新，请保留输入后重新载入");
  const next={...value,version:value.version+1};
  if(origin){
    db.exec("CREATE TABLE IF NOT EXISTS hot_origins(draft TEXT PRIMARY KEY,task TEXT UNIQUE,title TEXT,original TEXT,canonical TEXT,source TEXT)");
    db.prepare("INSERT INTO hot_origins VALUES(?,NULL,?,?,?,?)").run(next.id,origin.title,origin.original,origin.canonical,origin.source);
  }
  db.prepare("INSERT INTO production_drafts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,payload=excluded.payload,updated=excluded.updated")
    .run(next.id,next.version,JSON.stringify(next),new Date().toISOString());
  if(next.account)for(const item of next.brief?.materials??[])
    db.prepare("UPDATE production_material_owners SET account=? WHERE asset=? AND draft=? AND account=''").run(next.account,item.id,next.id);
  db.prepare("INSERT OR IGNORE INTO production_draft_order SELECT ?,coalesce(max(position),0)+1 FROM production_draft_order").run(next.id);
  if(next.intent==="queued"&&(!old||JSON.parse(String(old.payload)).intent!=="queued"))db.prepare("UPDATE production_draft_order SET position=(SELECT coalesce(max(position),0)+1 FROM production_draft_order) WHERE id=?").run(next.id);
  return next;
}
export function saveProductionDraft(raw:unknown,origin?:HotOrigin){
  const value=draftSchema.parse(raw),db=productionDb();
  try{
    db.exec("BEGIN IMMEDIATE");
    const next=writeDraft(db,value,origin);
    db.exec("COMMIT");return next;
  }finally{db.close();}
}
/** A batch form writes ordinary queued drafts in displayed order, all or none. */
export function enqueueProductionDrafts(raw:unknown){
  const drafts=z.array(draftSchema).min(1).max(100).parse(raw);
  const db=productionDb();
  try{
    db.exec("BEGIN IMMEDIATE");
    const accounts=entities(db,"account") as Entity[];
    const ids=new Set<string>(),pairs=new Set<string>();
    const queued=db.prepare("SELECT payload FROM production_drafts WHERE json_extract(payload,'$.intent')='queued'").all()
      .map(r=>draftSchema.parse(JSON.parse(String(r.payload))));
    const pair=(d:ProductionDraft)=>JSON.stringify([d.account,d.topic.normalize("NFKC").trim().toLowerCase()]);
    for(const d of queued)if(!drafts.some(draft=>draft.id===d.id))pairs.add(pair(d));
    const next=drafts.map((draft,index)=>{
      const row=index+1;
      if(draft.version!==0||draft.kind==="自由文章"||ids.has(draft.id))throw Error("第 "+row+" 行的需求编号无效或重复");
      if(!draft.topic||!draft.platform||!accounts.some(a=>a.id===draft.account&&a.status==="启用"))throw Error("第 "+row+" 行需要有效账号、平台和选题");
      const key=pair(draft);
      if(pairs.has(key))throw Error("第 "+row+" 行与同账号的另一条待生产选题重复");
      ids.add(draft.id);pairs.add(key);
      const value={...draft,intent:"queued" as const};
      const existing=queued.find(d=>d.id===value.id);
      if(existing&&JSON.stringify(existing)===JSON.stringify({...value,version:1}))return existing;
      return writeDraft(db,value);
    });
    db.exec("COMMIT");
    return next;
  }finally{db.close();}
}
export function submitBatch(input:{id:string;drafts:ProductionDraft[];tokenLimit:number;requestLimit:number;preview:unknown;authorizeText?:boolean;
  autopilot?:{parent?:string;materials:ReadonlyMap<string,CruiseMaterial>}},single=false){
  z.uuid().parse(input.id);
  if(single&&input.drafts.length!==1)throw Error("单篇创作需要一条草稿");
  if(!input.drafts.length||input.drafts.length>100)throw Error("每批次需要 1 至 100 条任务");
  z.number().int().min(1000).max(2000000).parse(input.tokenLimit);
  z.number().int().min(1).max(600).parse(input.requestLimit);
  if(!modelConfigured())throw Error("请先配置本机模型；云端批次尚未授权");
  const mode=cloudEnabled()?"真实云端" as const:process.env.STUDIO_DEMO_INSTANCE==="1"?"离线示例" as const:"本机模型" as const;
  if(input.autopilot&&mode==="真实云端")throw Error("无人值守预生产不提交云端模型。");
  const previews=input.drafts.map(d=>previewDraft(d));
  if(JSON.stringify(previews)!==JSON.stringify(input.preview))throw Error("账号、资料或规范已变化，请重新预检");
  if(cloudEnabled()&&process.env.STUDIO_PRODUCTION_SCOPE==="deepseek-production"&&input.authorizeText!==true)
    throw Error("请明确授权将本次稿件要求与获准使用的资料发送给 DeepSeek");
  if(cloudEnabled()&&previews.some(p=>p.authorBrief!==undefined&&p.attachments.length)&&(!single||input.authorizeText!==true))throw Error("请在单篇确认页明确授权本次文本材料发送给 DeepSeek");
  const db=productionDb();
  try{
    db.exec("BEGIN IMMEDIATE");
    if(db.prepare("SELECT id FROM production_batches WHERE id=?").get(input.id))return input.id;
    for(const draft of input.drafts){
      const matches=matrixMatches(db,draft,input.drafts);
      if(matches.length&&!draft.experiment)throw Error("可能撞车："+matches.slice(0,3).map(item=>item.title+"（"+item.state+"）").join("、")+"。请返回预检查看来源或登记同题实验。");
    }
    if(single&&!db.prepare("SELECT 1 FROM production_workers WHERE seen>? LIMIT 1").get(Date.now()-workerHeartbeatWindowMs))throw Error("生成后台离线。草稿已保存，恢复后台后请重新检查状态。");
    if(new Set(input.drafts.map(d=>d.id)).size!==input.drafts.length)throw Error("清单中有重复草稿");
    db.prepare("INSERT INTO production_batches VALUES(?,?,1,0,?,?,?)").run(input.id,new Date().toISOString(),input.tokenLimit,input.requestLimit,mode);
    input.drafts.forEach((d,i)=>{
      const row=db.prepare("SELECT payload,version FROM production_drafts WHERE id=?").get(d.id);
      if(d.intent!==(single?"draft":"queued"))throw Error(single?"此稿已在批量清单，请在批量填报中处理":"需求草稿尚未主动加入待生产清单："+d.topic);
      if(!row||row.version!==d.version||JSON.stringify(draftSchema.parse(JSON.parse(String(row.payload))))!==JSON.stringify(d))throw Error("清单已变化，请重新预检");
      if(d.bricks?.length)freezeBricks(db,d.account,d.bricks);
      const id=randomUUID();
      const p=previews[i];
      if(d.series){
        const frozen=seriesSources(db,d.account,d.series).slice(-5);
        if(JSON.stringify(frozen)!==JSON.stringify(p.seriesSources))throw Error("前序专题版本已变化，请重新预检");
        claimSeries(db,d.account,d.series,id);
      }
      const material=input.autopilot?.materials.get(d.id);
      if(input.autopilot&&!material)throw Error("缺少巡航原始资料");
      const task:Task={id,revision:0,stage:"assemble",records:[],input:brief.parse({persona:"general",topic:d.topic,audience:p.resolved?.audience??d.audience,format:d.kind==="口播稿"?"口播稿":d.kind==="分镜脚本"?"短视频脚本":"图文文章",goal:p.resolved?.goal??d.goal,style:p.resolved?.style?.slice(0,600),mode:"keyword",generate:true,sources:d.sources.length?d.sources:undefined,production:{...p,mode,experiment:d.experiment,...(material?{draftId:d.id,sourceMaterials:[material]}:{})}})};
      if(input.autopilot)linkAutopilotTask(db,id,input.autopilot.parent);
      if(cloudEnabled())db.prepare("INSERT INTO production_cloud_grants VALUES(?,?,?,?)").run(id,inputHash(task.input),process.env.STUDIO_MODEL!,new Date().toISOString());
      db.prepare("INSERT INTO versions VALUES(?,?,?)").run(id,0,JSON.stringify(task));
      db.prepare("INSERT INTO production_queue VALUES(?,?,?,'排队','',NULL,NULL,?)").run(id,input.id,i,new Date().toISOString());
      if(single&&d.brief){
        for(const supplement of briefSuggestions(d.brief))db.prepare("INSERT INTO production_supplements VALUES(?,?,?,'pending')").run(id,supplement.key,supplement.label);
        db.prepare("INSERT INTO production_brief_records VALUES(?,?)").run(id,JSON.stringify({note:d.brief.note,goal:p.resolved?.goal,audience:p.resolved?.audience,materials:d.brief.materials.map(({id,name,source,purpose})=>({id,name,source,purpose})),references:d.sources,articles:p.reused}));
        for(const image of p.illustrations??[])db.prepare("UPDATE production_material_owners SET draft=? WHERE asset=? AND draft=?").run(id,image.id,d.id);
      }
      for(const table of ["archived_tasks","content_notes"]){
        if(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table))db.prepare("UPDATE "+table+" SET id=? WHERE id=?").run(id,d.id);
      }
      if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='hot_origins'").get())db.prepare("UPDATE hot_origins SET task=? WHERE draft=?").run(id,d.id);
      db.prepare("DELETE FROM production_drafts WHERE id=?").run(d.id);event(db,id,0,"排队",d.topic);
    });
    db.exec("COMMIT");return input.id;
  }finally{db.close();}
}
export function queueAction(action:"reorder"|"stop"|"retry",batch:string,version:number,ids:string[]){
  const db=productionDb();
  try{
    db.exec("BEGIN IMMEDIATE");
    const b=db.prepare("SELECT * FROM production_batches WHERE id=?").get(batch);
    if(!b||b.version!==version)throw Error("批次顺序或状态已改变，请刷新后重试");
    const rows=db.prepare("SELECT * FROM production_queue WHERE batch=?").all(batch);
    if(ids.some(id=>!rows.some(r=>r.task===id)))throw Error("任务不属于此批次");
    if(action==="reorder"){
      const pending=rows.filter(r=>r.status==="排队"&&Number(db.prepare("SELECT max(rev) AS rev FROM versions WHERE id=?").get(r.task)?.rev)===0).map(r=>String(r.task));
      if(ids.length!==pending.length||new Set(ids).size!==ids.length||ids.some(id=>!pending.includes(id)))throw Error("只能调整尚未领取的全部任务");
      ids.forEach((id,i)=>db.prepare("UPDATE production_queue SET position=? WHERE task=?").run(i+1000,id));
    }else for(const id of ids){
      const row=rows.find(r=>r.task===id)!;
      if(action==="retry"&&autopilotHopState(db,id)?.fused)throw Error(hopHandoff);
      const savedFlow=db.prepare("SELECT payload FROM collaboration WHERE task=?").get(id);
      const f:Flow|undefined=savedFlow?JSON.parse(String(savedFlow.payload)):undefined;
      if(action==="stop"){
        db.prepare("UPDATE production_queue SET status='已停止',reason='停止后续执行；在途请求仍可能返回',updated=? WHERE task=?").run(new Date().toISOString(),id);
        if(f){f.state="stopped";f.revision++;f.reason="队列已停止，结果只留存";}
      }else{
        const calls=db.prepare("SELECT payload FROM model_calls WHERE task_id=?").all(id).map(r=>JSON.parse(String(r.payload)));
        if(calls.some(c=>c.usage==="unknown"||c.status==="running")||Number(row.lease)>Date.now())throw Error("请求仍在执行或结果未知，请先核对回执");
        if(f&&(f.state==="unknown"||f.state==="running"||f.executions.some(e=>!e.ended)))throw Error("协作结果尚未核实，禁止重发");
        if(!["失败","已停止"].includes(String(row.status)))throw Error("此状态不可重试");
        if(f&&["failed","stopped"].includes(f.state)){f.state="ready";f.revision++;f.reason="仅继续未完成协作步骤";}
        db.prepare("UPDATE production_queue SET status='排队',owner=NULL,lease=NULL,reason='' WHERE task=?").run(id);
      }
      if(f)db.prepare("UPDATE collaboration SET payload=? WHERE task=?").run(JSON.stringify(f),id);
    }
    for(const id of ids){
      const revision=Number(db.prepare("SELECT max(rev) AS revision FROM versions WHERE id=?").get(id)?.revision??0);
      event(db,id,revision,action==="stop"?"已停止":action==="retry"?"重新排队":"顺序更新",action);
    }
    db.prepare("UPDATE production_batches SET version=version+1 WHERE id=?").run(batch);
    db.exec("COMMIT");
  }finally{db.close();}
}
function recordHeartbeat(db:ReturnType<typeof productionDb>,owner:string){
  db.prepare("INSERT INTO production_workers VALUES(?,?,'运行') ON CONFLICT(id) DO UPDATE SET seen=excluded.seen,state=excluded.state").run(owner,Date.now());
}
export function workerHeartbeat(owner:string){
  const db=productionDb();
  try{recordHeartbeat(db,owner);}finally{db.close();}
}
export async function workerTick(owner:string){
  const db=productionDb();let id="";
  try{
    db.exec("BEGIN IMMEDIATE");
    recordHeartbeat(db,owner);
    const active=db.prepare("SELECT * FROM production_queue WHERE owner IS NOT NULL AND status NOT IN ('待人工审核','受阻','失败','已停止')").all();
    const concurrency=Math.max(1,Math.min(4,Number(process.env.STUDIO_CONCURRENCY)||1));
    if(active.filter(row=>Number(row.lease)>Date.now()).length>=concurrency){db.exec("COMMIT");return;}
    for(const row of active){
      if(Number(row.lease)>Date.now())continue;
      const payload=db.prepare("SELECT payload FROM versions WHERE id=? ORDER BY rev DESC LIMIT 1").get(row.task);
      const task:Task=JSON.parse(String(payload?.payload));
      const calls=db.prepare("SELECT payload FROM model_calls WHERE task_id=?").all(row.task).map(r=>JSON.parse(String(r.payload)));
      const flowRow=db.prepare("SELECT payload FROM collaboration WHERE task=?").get(row.task);
      const interrupted:Flow|undefined=flowRow?JSON.parse(String(flowRow.payload)):undefined;
      const uncertain=interrupted?.state==="running"||interrupted?.state==="unknown"||calls.some(c=>c.usage==="unknown"||c.status==="running")||
        Boolean(task.lease&&calls.some(c=>Date.parse(c.started)>=task.lease!-240000));
      const failed=!uncertain&&task.records.at(-1)?.status==="failed";
      if(uncertain){
        if(interrupted){interrupted.state="unknown";interrupted.revision++;interrupted.reason="队列租约过期，协作结果未落盘；禁止自动重发";db.prepare("UPDATE collaboration SET payload=? WHERE task=?").run(JSON.stringify(interrupted),task.id);}
        task.stage="blocked";task.revision++;delete task.lease;
        task.records.push({node:"recovery",status:"blocked",started:new Date().toISOString(),ended:new Date().toISOString(),error:"worker 租约过期，已发出请求结果未知，需人工核实"});
        db.prepare("INSERT INTO versions VALUES(?,?,?)").run(task.id,task.revision,JSON.stringify(task));
      }
      db.prepare("UPDATE production_queue SET status=?,reason=?,owner=NULL,lease=NULL WHERE task=?").run(uncertain?"受阻":failed?"失败":"排队",uncertain?"未知回执或未落盘结果，禁止自动重发":failed?"上次步骤失败，等待人工处理":"安全阶段恢复",row.task);
    }
    const row=db.prepare("SELECT q.task FROM production_queue q JOIN production_batches b ON b.id=q.batch WHERE q.status='排队' AND b.stopped=0 ORDER BY b.created,CASE WHEN (SELECT max(rev) FROM versions WHERE id=q.task)>0 THEN 0 ELSE 1 END,q.position LIMIT 1").get();
    if(!row){db.exec("COMMIT");return;}
    id=String(row.task);
    const task:Task=JSON.parse(String(db.prepare("SELECT payload FROM versions WHERE id=? ORDER BY rev DESC LIMIT 1").get(id)?.payload));
    const storedFlow=db.prepare("SELECT payload FROM collaboration WHERE task=?").get(id);
    const current:Flow|undefined=storedFlow?JSON.parse(String(storedFlow.payload)):undefined;
    const phase=task.stage==="research"||task.stage==="write"?"generation":task.stage==="done"?(current?.step==="revision"?"revision":"review"):undefined;
    if(phase&&!reserveAutopilotHop(db,id,phase,phase==="generation"?0:current?.articleVersion??task.article!.version)){
      if(current){
        current.state="human";current.reason=hopHandoff;current.revision++;
        db.prepare("UPDATE collaboration SET payload=? WHERE task=?").run(JSON.stringify(current),id);
      }
      db.prepare("UPDATE production_queue SET status='受阻',reason=?,owner=NULL,lease=NULL,updated=? WHERE task=?").run(hopHandoff,new Date().toISOString(),id);
      event(db,id,task.revision,"受阻",hopHandoff);
      db.exec("COMMIT");return;
    }
    const label=task.stage==="done"?(storedFlow&&JSON.parse(String(storedFlow.payload)).step==="revision"?"修订":"审核"):task.stage==="write"?"生成":"整理资料";
    db.prepare("UPDATE production_queue SET owner=?,lease=?,status=?,updated=? WHERE task=?").run(owner,Date.now()+(process.env.STUDIO_DEMO_INSTANCE==="1"?Number(process.env.STUDIO_QUEUE_LEASE_MS)||300000:300000),label,new Date().toISOString(),id);
    db.prepare("UPDATE production_batches SET version=version+1 WHERE id=(SELECT batch FROM production_queue WHERE task=?)").run(id);
    db.exec("COMMIT");
  }finally{db.close();}
  let status="排队",reason="";
  try{
    let t=lookup(id)!;
    if(t.stage==="done"){
      let f=flow(id)??control(id,"start",undefined,{professional:true});
      if(f.state==="ready")f=(await tick(id,f.revision))!;
      status=f.state==="awaiting_acceptance"?"待人工审核":f.state==="failed"?"失败":
        ["human","unknown","paused"].includes(f.state)?"受阻":f.state==="stopped"?"已停止":"排队";
      reason=f.state==="awaiting_acceptance"?"专业角色检查完成，业务标准未配置时仅代表基础检查；待人工确认":f.reason||("专业协作："+f.step);

    }
    else{
      t=(await advance(id,t.revision,true))!;
      if(t.stage==="done")status="排队";
      else if(t.stage==="blocked"){status="受阻";reason=t.records.at(-1)?.error??"缺少资料";}
      else if(t.records.at(-1)?.status==="failed"){status="失败";reason=t.records.at(-1)?.error??"执行失败";}
    }
  }catch(e){status="失败";reason=e instanceof Error?e.message:"执行失败";}
  const finish=productionDb();
  try{
    finish.exec("BEGIN IMMEDIATE");
    const row=finish.prepare("SELECT owner,status FROM production_queue WHERE task=?").get(id);
    if(row?.owner===owner&&row.status!=="已停止"){
      finish.prepare("UPDATE production_queue SET status=?,reason=?,owner=NULL,lease=NULL,updated=? WHERE task=?").run(status,reason,new Date().toISOString(),id);
      const rev=Number(finish.prepare("SELECT max(rev) AS rev FROM versions WHERE id=?").get(id)?.rev);
      event(finish,id,rev,status,reason||"步骤已保存");
    }
    finish.exec("COMMIT");
  }finally{finish.close();}
}

export function createBlankArticle(title="未命名自由文章"){
 const id=randomUUID(),batch=randomUUID(),now=new Date().toISOString(),db=productionDb();
 const input=brief.parse({persona:"general",topic:title||"未命名自由文章",format:"图文文章",goal:"自由表达",mode:"keyword",generate:false});
 const task:Task={id,revision:1,input,stage:"done",records:[],research:{version:1,model:"manual",status:"ready",questions:[],evidence:[]},article:{version:1,researchVersion:1,title:input.topic,body:"",citations:[],model:"manual"}};
 try{db.exec("BEGIN IMMEDIATE");
 db.prepare("INSERT INTO versions VALUES(?,?,?)").run(id,1,JSON.stringify(task));
 db.prepare("INSERT INTO production_batches VALUES(?,?,1,0,0,0,'手写文章')").run(batch,now);
 db.prepare("INSERT INTO production_queue VALUES(?,?,0,'草稿','直接手写，不调用模型',NULL,NULL,?)").run(id,batch,now);
 db.exec("COMMIT");return id;
 }finally{db.close();}
}
