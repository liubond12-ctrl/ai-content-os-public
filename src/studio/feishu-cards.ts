import {DatabaseSync} from "node:sqlite";
import {createHash,randomUUID} from "node:crypto";
import {productionDb} from "./production-db";
import {articleStateInTransaction,changeArticleInTransaction,ensureArticleTables} from "./article-store";
import type {Flow} from "./collaboration";
import type {Opinion} from "./professional-review";
import type {MorningCandidate} from "../types/autopilot";
import {cruiseDay,currentMorningCandidate,decideMorning,morning,morningBinding,rerunAvailable} from "./autopilot";
import {ensureAutopilotGuard,hopHandoff} from "./autopilot-guard";
import {ensureFeishuResolutions,resolvedInWorkbench,resolvedOnWeb} from "./feishu-resolution";
import {duePublications,getRetros} from "./calibration";
import {budgetDay,budgetTables} from "./readiness-budget";

export type Kind="batch"|"blocked"|"choice";
export interface Card {kind:Kind|"morning"|"morning-item"|"handoff"|"retro"|"budget";title:string;text:string;task:string;version:number;review:string;binding:string;options:string[];day?:string;candidate?:MorningCandidate}
export const mockAuthor="local-preview-author";
export function cardDb(timeout=5000){
  const existing=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
  try{existing.exec("PRAGMA busy_timeout="+timeout);if(existing.prepare("SELECT 1 FROM sqlite_master WHERE name='fs_change_article_drafts_UPDATE'").get()){
    ensureAutopilotGuard(existing);ensureFeishuResolutions(existing);return existing;
  }}catch(e){existing.close();throw e;}
  existing.close();const db=productionDb();ensureArticleTables(db);ensureFeishuResolutions(db);
  db.exec(`CREATE TABLE IF NOT EXISTS fs_notify(mode TEXT PRIMARY KEY,settings TEXT NOT NULL,since TEXT NOT NULL,heartbeat INTEGER DEFAULT 0,link TEXT DEFAULT '未连接');
  CREATE TABLE IF NOT EXISTS fs_outbox(id TEXT PRIMARY KEY,mode TEXT,owner TEXT,slot TEXT,card TEXT,message TEXT DEFAULT '',delivery TEXT DEFAULT 'pending',result TEXT DEFAULT '',sentHash TEXT DEFAULT '',UNIQUE(mode,owner,slot));
  CREATE TABLE IF NOT EXISTS fs_created(id TEXT PRIMARY KEY,created INTEGER NOT NULL);
  CREATE TRIGGER IF NOT EXISTS fs_track_created AFTER INSERT ON fs_outbox BEGIN INSERT INTO fs_created VALUES(NEW.id,CAST(unixepoch('subsec')*1000 AS INTEGER)); END;
  CREATE TABLE IF NOT EXISTS fs_inbox(id TEXT PRIMARY KEY REFERENCES fs_outbox(id),action TEXT,status TEXT,detail TEXT,received INTEGER);
  CREATE TABLE IF NOT EXISTS fs_sim_messages(id TEXT PRIMARY KEY,body TEXT,uuid TEXT UNIQUE);`);
  db.exec(`CREATE TABLE IF NOT EXISTS fs_clock(id INTEGER PRIMARY KEY,v INTEGER NOT NULL);INSERT OR IGNORE INTO fs_clock VALUES(1,0);
    CREATE TABLE IF NOT EXISTS fs_scan(mode TEXT,owner TEXT,scope TEXT,v INTEGER,PRIMARY KEY(mode,owner,scope));`);
  for(const [table,actions] of [["production_queue",["INSERT","UPDATE","DELETE"]],["article_snapshots",["INSERT"]],["collaboration",["INSERT","UPDATE"]],["article_drafts",["INSERT","UPDATE"]]] as const){
    for(const action of actions)db.exec(`CREATE TRIGGER IF NOT EXISTS fs_change_${table}_${action} AFTER ${action} ON ${table} BEGIN UPDATE fs_clock SET v=v+1 WHERE id=1; END;`);
  }
  return db;
}
export type Mode="mock"|"live";
export function prefs(db:DatabaseSync,mode:Mode){
  db.prepare("INSERT OR IGNORE INTO fs_notify(mode,settings,since) VALUES(?,?,?)").run(mode,JSON.stringify({batch:true,blocked:true,choice:true}),new Date().toISOString());
  const row=db.prepare("SELECT * FROM fs_notify WHERE mode=?").get(mode)!;
  return {enabled:JSON.parse(String(row.settings)) as Record<Kind,boolean>,since:String(row.since),heartbeat:Number(row.heartbeat),online:Date.now()-Number(row.heartbeat)<15000,link:String(row.link)};
}
export function savePrefs(mode:Mode,enabled:Record<Kind,boolean>){const db=cardDb();try{db.exec("BEGIN IMMEDIATE");prefs(db,mode);db.prepare("DELETE FROM fs_scan WHERE mode=?").run(mode);db.prepare("UPDATE fs_notify SET settings=? WHERE mode=?").run(JSON.stringify(enabled),mode);db.exec("COMMIT");}finally{db.close();}}
const deferred="已记录稍后处理，任务仍待处理";
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function taskState(db:DatabaseSync,task:string){
  const row=db.prepare("SELECT q.status,q.reason,q.updated,v.rev,v.payload FROM production_queue q JOIN versions v ON q.task=v.id WHERE q.task=? ORDER BY v.rev DESC LIMIT 1").get(task);
  if(!row)return null;
  const frow=db.prepare("SELECT payload FROM collaboration WHERE task=?").get(task);
  const f:Flow|undefined=frow?JSON.parse(String(frow.payload)):undefined;
  const t=JSON.parse(String(row.payload));
  const a=t.article?articleStateInTransaction(db,task):undefined;
  const panel=f?.panels?.at(-1);
  const currentReview=db.prepare("SELECT 1 FROM sqlite_master WHERE name='reviews'").get()&&a?
    db.prepare("SELECT id FROM reviews WHERE task=? AND article=? ORDER BY version DESC LIMIT 1").get(task,a.head.version)?.id:undefined;
  const binding=hash([task,row.rev,row.status,row.reason,row.updated,a?.head.version,a?.draft?.revision,f?.revision,currentReview]);
  const base={task,version:a?.head.version||0,review:String(currentReview||""),binding};
  let options:Opinion[]=[];
  if(a&&!a.head.confirmed&&row.status==="受阻"&&f?.state==="human"&&panel?.status==="human"&&panel.id===currentReview&&panel.id===f.reviewId&&f.articleVersion===a.head.version&&panel.articleVersion===a.head.version&&panel.phase==="complete"&&panel.verdict?.decisions.length===1&&panel.verdict.decisions[0].action==="human"&&
    !panel.reviews.some(r=>r.result.status==="blocked"||r.result.facts.checks.some(c=>c.status!=="来源原文匹配")||r.result.facts.requestTriggered&&!r.result.facts.checks.length)){
    const opinions=panel.reviews.flatMap(r=>r.opinions);
    const pair=panel.verdict.decisions[0].opinionIds.map(id=>opinions.find(o=>o.id===id));
    if(opinions.length===2&&pair.length===2&&pair.every(o=>o&&o.role!=="facts"&&o.issue.type==="表达")&&pair[0]!.issue.field===pair[1]!.issue.field&&pair[0]!.issue.offset===pair[1]!.issue.offset&&pair[0]!.issue.quote===pair[1]!.issue.quote)options=pair as Opinion[];
  }
  const reason=String(row.reason||f?.reason||"需核对任务进度");
  const display=String(t.input.topic);
  let card:Card|null=null;
  if(options.length){
    const lines=options.map((o,i)=>(i?"B":"A")+" · "+(o.action==="retain"?"保留原句":o.action==="delete"?"删除原句":"替换为「"+o.replacement+"」")+"："+o.issue.reason);
    card={...base,kind:"choice",title:"主观取舍 · "+display,text:["原句："+options[0].issue.quote,...lines].join("\n"),options:["A","B","later"]};
  }else if(!a?.head.confirmed&&["受阻","失败"].includes(String(row.status))){
    card={...base,kind:"blocked",title:"需要处理 · "+display,text:reason+"\n下一步："+(/事实|证据|来源|资料/.test(reason)?"在电脑工作台补充来源并核对原句。":"在电脑工作台查看执行记录，核对原因后处理。"),options:["later"]};
  }
  return {card,options,f,a};
}
function storeCard(db:DatabaseSync,mode:Mode,owner:string,slot:string,c:Card){
  db.prepare("INSERT INTO fs_outbox(id,mode,owner,slot,card) VALUES(?,?,?,?,?) ON CONFLICT(mode,owner,slot) DO UPDATE SET card=excluded.card WHERE fs_outbox.card<>excluded.card").run(randomUUID(),mode,owner,slot,JSON.stringify(c));
}
function morningAllowed(mode:Mode){
  return mode==="mock"?process.env.STUDIO_DEMO_INSTANCE==="1":process.env.STUDIO_DEMO_INSTANCE!=="1"&&
    process.env.FEISHU_MORNING_SEND_APPROVED==="1"&&!process.env.FEISHU_CARD_PILOT_TASK;
}
function retroAllowed(mode:Mode){
  return mode==="mock"?process.env.STUDIO_DEMO_INSTANCE==="1":process.env.STUDIO_DEMO_INSTANCE!=="1"&&
    process.env.FEISHU_RETRO_SEND_APPROVED==="1"&&!process.env.FEISHU_CARD_PILOT_TASK;
}
function cardEnabled(db:DatabaseSync,mode:Mode,card:Card){
  if(card.kind==="budget")return morningAllowed(mode);
  if(card.kind==="retro")return retroAllowed(mode);
  return card.kind==="morning"||card.kind==="morning-item"||card.kind==="handoff"?morningAllowed(mode):prefs(db,mode).enabled[card.kind];
}
function collectMorning(db:DatabaseSync,mode:Mode,owner:string){
  if(!morningAllowed(mode))return;
  const day=cruiseDay(),items=morning(db,day).items;
  const candidates=items.flatMap(item=>item.candidate&&!item.decision?[item.candidate]:[]);
  if(!candidates.length)return;
  if(items.some(item=>item.reason==="等待生成或专业审核"))return;
  const describe=(candidate:MorningCandidate)=>[
    candidate.title+" · "+candidate.account+" · "+candidate.score+" 分",
    candidate.summary,
    "核心分歧："+(candidate.disagreements.join("、")||"没有记录分歧"),
  ].join("\n");
  storeCard(db,mode,owner,"morning:"+day,{kind:"morning",title:"飞书早报 · "+day,text:candidates.map(describe).join("\n\n"),task:"",version:0,review:"",binding:day,day,options:[]});
  for(const candidate of candidates){
    const binding=morningBinding(candidate);
    storeCard(db,mode,owner,"morning-item:"+day+":"+binding,{kind:"morning-item",title:"早报翻牌 · "+candidate.title,text:describe(candidate),
      task:candidate.taskId,version:candidate.articleVersion,review:candidate.reviewId,binding,day,candidate,
      options:rerunAvailable(db,day,candidate.taskId)?["approve","rerun"]:["approve"]});
  }
}
export function collect(db:DatabaseSync,mode:Mode,owner:string){
  collectMorning(db,mode,owner);
  if(morningAllowed(mode)){
    budgetTables(db);
    const day=budgetDay(),alert=db.prepare("SELECT reason FROM daily_model_alert WHERE day=?").get(day);
    if(alert)storeCard(db,mode,owner,"budget:"+day,{kind:"budget",title:"巡航预算暂停 · "+day,text:String(alert.reason),
      day,task:"",version:0,review:"",binding:day,options:[]});
  }
  if(retroAllowed(mode)){
    for(const item of duePublications(db)){
      const slot="retro:"+item.task+":"+item.version;
      storeCard(db,mode,owner,slot,{kind:"retro",title:"T+3d 复盘 · "+item.prediction.title,
        text:"请在工作台记录播放或阅读、赞、藏、评论和转化。预测流量区间："+
          item.prediction.ranges.reach.join("–")+"。",task:item.task,version:item.version,review:"",binding:slot,options:[]});
    }
  }
  if(morningAllowed(mode)){
    const fused=db.prepare(`SELECT f.task,json_extract(v.payload,'$.input.topic') AS title,
      COALESCE((SELECT max(version) FROM article_snapshots WHERE task_id=f.task),json_extract(v.payload,'$.article.version'),0) AS version
      FROM autopilot_fuses f JOIN production_queue q ON q.task=f.task
      JOIN versions v ON v.id=f.task AND v.rev=(SELECT max(rev) FROM versions WHERE id=f.task) WHERE q.status='受阻'`).all();
    for(const row of fused){
      const task=String(row.task),version=Number(row.version),title=String(row.title);
      if(version&&resolvedOnWeb(db,task,version))continue;
      storeCard(db,mode,owner,"handoff:"+task,{kind:"handoff",title:"转人工 · "+title,
        text:hopHandoff+"。可在工作台查看已保存的结果。",task,version,review:"",binding:"handoff:"+task,options:[]});
    }
  }
  const {enabled,since}=prefs(db,mode);
  const pilot=mode==="live"?process.env.FEISHU_CARD_PILOT_TASK||"":"";
  const generation=Number(db.prepare("SELECT v FROM fs_clock WHERE id=1").get()?.v);
  if(db.prepare("SELECT v FROM fs_scan WHERE mode=? AND owner=? AND scope=?").get(mode,owner,pilot)?.v===generation)return;
  db.prepare("INSERT OR REPLACE INTO fs_scan VALUES(?,?,?,?)").run(mode,owner,pilot,generation);
  const rows=db.prepare("SELECT q.task,q.batch,q.status,json_extract(v.payload,'$.input.production.accountName') account,json_extract(v.payload,'$.article.version') original,(SELECT version FROM article_snapshots WHERE task_id=q.task ORDER BY version DESC LIMIT 1) edited,(SELECT json_extract(payload,'$.confirmed') FROM article_snapshots WHERE task_id=q.task ORDER BY version DESC LIMIT 1) confirmed FROM production_queue q JOIN production_batches b ON b.id=q.batch JOIN versions v ON v.id=q.task AND v.rev=(SELECT max(rev) FROM versions WHERE id=q.task) WHERE ((?='' AND (b.created>=? OR b.id IN (SELECT batch FROM production_queue WHERE updated>=?))) OR q.task=?) ORDER BY b.created,q.position").all(pilot,since,since,pilot);
  const batches=new Map<string,{accounts:Set<string>;generated:number;review:number;blocked:number;total:number}>();
  for(const row of rows){
    const batch=String(row.batch),confirmed=!!row.confirmed&&Number(row.edited)>=Number(row.original||0);
    const b=batches.get(batch)||{accounts:new Set<string>(),generated:0,review:0,blocked:0,total:0};
    b.accounts.add(String(row.account||"自由创作"));b.total++;if(row.original||row.edited)b.generated++;if(!confirmed&&row.status==="待人工审核")b.review++;if(!confirmed&&["受阻","失败"].includes(String(row.status)))b.blocked++;batches.set(batch,b);
    if(!confirmed&&["受阻","失败"].includes(String(row.status))){
    const c=taskState(db,String(row.task))?.card;if(c&&cardEnabled(db,mode,c)&&(!pilot||c.kind==="choice"&&c.binding===process.env.FEISHU_CARD_PILOT_BINDING))storeCard(db,mode,owner,c.task+":"+c.binding,c);
    }
  }
  if(enabled.batch&&!pilot)for(const [batch,b] of batches)storeCard(db,mode,owner,batch,{kind:"batch",title:"批次进展",text:[Array.from(b.accounts).join("、"),"共 "+b.total+" 条 · 已生成 "+b.generated+" · 待审核 "+b.review+" · 需处理 "+b.blocked].join("\n"),task:"",version:0,review:"",binding:batch,options:[]});
}
export function versionLabel(c:Card){
  if(!c.task)return "";
  return (c.version?"正文 v"+c.version:"尚无正文")+(c.review?" · 审核 "+c.review.slice(0,8):"");
}
export function decisionLabel(action:string){
  return action==="approve"?"通过并进入分发":action==="rerun"?"打回重跑":action==="later"?"稍后处理":"采用方案 "+action;
}
export function renderCard(id:string,c:Card,result=""){
  const text=[c.text,versionLabel(c),result,"请在电脑工作台查看正文与执行记录。"].filter(Boolean).join("\n");
  const elements:object[]=[{tag:"div",text:{tag:"plain_text",content:text}}];
  const available=!result?c.options:result===deferred&&c.kind==="choice"?c.options.filter(a=>a!=="later"):[];
  if(available.length)elements.push({tag:"action",actions:available.map(action=>({tag:"button",text:{tag:"plain_text",content:decisionLabel(action)},value:{decision:id,action}}))});
  return {config:{update_multi:true},header:{template:c.kind==="batch"||c.kind==="morning"?"blue":c.kind==="choice"||c.kind==="morning-item"?"purple":"orange",title:{tag:"plain_text",content:c.title}},elements};
}
export type Callback={operator?:{open_id?:string};context?:{open_message_id?:string};action?:{value?:{decision?:string;action?:string}}};
export function receive(mode:Mode,owner:string,event:Callback){
  const db=cardDb(350);try{
    db.exec("BEGIN IMMEDIATE");
    const id=event.action?.value?.decision,action=event.action?.value?.action;
    if(!id||!action||!owner||event.operator?.open_id!==owner)throw Error("操作者不匹配");
    const row=db.prepare("SELECT * FROM fs_outbox WHERE id=? AND mode=? AND owner=?").get(id,mode,owner);
    if(!row?.message||row.message!==event.context?.open_message_id)throw Error("消息不匹配");
    const c:Card=JSON.parse(String(row.card));
    if(!c.options.includes(action)||!cardEnabled(db,mode,c))throw Error("操作不可用");
    if(resolvedOnWeb(db,c.task,c.version))throw Error(resolvedInWorkbench);
    const existing=db.prepare("SELECT action,status,detail FROM fs_inbox WHERE id=?").get(id);
    const resume=existing?.action==="later"&&existing.detail===deferred&&c.kind==="choice"&&action!=="later";
    if(existing&&!resume){db.exec("COMMIT");return (existing.action===action?"":"已记录其他选择：")+String(existing.detail);}
    if(!valid(db,c,id))throw Error("卡片已过期，请查看电脑工作台");
    if(resume)db.prepare("UPDATE fs_inbox SET action=?,status='pending',detail='决定已接收',received=? WHERE id=?").run(action,Date.now(),id);
    else db.prepare("INSERT INTO fs_inbox VALUES(?,?,'pending','决定已接收',?)").run(id,action,Date.now());
    db.prepare("UPDATE fs_outbox SET result='决定已接收' WHERE id=?").run(id);
    db.exec("COMMIT");return "决定已接收";
  }finally{db.close();}
}
function valid(db:DatabaseSync,c:Card,id:string){
  if(c.task&&resolvedOnWeb(db,c.task,c.version))return false;
  const row=db.prepare("SELECT created FROM fs_created WHERE id=?").get(id);
  if(!row||Number(row.created)+86400000<=Date.now())return false;
  if(c.kind==="morning-item"){
    const current=c.day&&currentMorningCandidate(db,c.day,c.task);
    return !!current&&morningBinding(current)===c.binding;
  }
  return taskState(db,c.task)?.card?.binding===c.binding;
}
export function applyPending(db:DatabaseSync,mode:Mode,owner:string){
  const pending=db.prepare("SELECT i.id,i.action,o.card FROM fs_inbox i JOIN fs_outbox o USING(id) WHERE i.status='pending' AND o.mode=? AND o.owner=?").all(mode,owner);
  for(const row of pending){
    db.exec("BEGIN IMMEDIATE");
    try{
      if(!db.prepare("SELECT 1 FROM fs_inbox WHERE id=? AND status='pending'").get(row.id)){db.exec("COMMIT");continue;}
      const c:Card=JSON.parse(String(row.card));
      let result="版本或任务已变化，决定已过期";
      if(valid(db,c,String(row.id))&&cardEnabled(db,mode,c)){
        if(c.kind==="morning-item"){
          if(!c.day||!c.candidate||(row.action!=="approve"&&row.action!=="rerun"))throw Error("早报决定无效");
          result=decideMorning(db,c.day,c.candidate,row.action);
        }else{
        const s=taskState(db,c.task);
        if(!s)throw Error("任务已改变");
        if(row.action==="later")result=deferred;
        else{
          const index=row.action==="A"?0:1,o=s.options[index];
          if(!o||!s.a||!s.f)throw Error("意见已变化");
          const state=changeArticleInTransaction(db,{action:"decide",taskId:c.task,baseVersion:c.version,revision:s.a.draft?.revision??0,review:c.review,issue:index,choice:o.action==="retain"?"retain":"accept",reason:o.issue.reason,replacement:o.action==="delete"?"":o.replacement},o);
          const reason="作者已采用方案 "+row.action+"，请在电脑工作台审阅新版";
          const f=s.f;f.state="awaiting_acceptance";f.articleVersion=state.head.version;f.reason=reason;f.revision++;
          db.prepare("UPDATE collaboration SET payload=? WHERE task=?").run(JSON.stringify(f),c.task);
          db.prepare("UPDATE production_queue SET status='待人工审核',reason=?,updated=? WHERE task=?").run(reason,new Date().toISOString(),c.task);
          result="已完成 · 正文 v"+state.head.version+" 待人工审核";
        }
        }
      }
      db.prepare("UPDATE fs_inbox SET status='closed',detail=? WHERE id=?").run(result,row.id);
      db.prepare("UPDATE fs_outbox SET result=? WHERE id=?").run(result,row.id);
      db.exec("COMMIT");
    }catch(e){
      db.exec("ROLLBACK");const msg="未应用："+(e instanceof Error?e.message:"需人工处理");
      db.exec("BEGIN IMMEDIATE");const changed=db.prepare("UPDATE fs_inbox SET status='failed',detail=? WHERE id=? AND status='pending'").run(msg,row.id);if(changed.changes)db.prepare("UPDATE fs_outbox SET result=? WHERE id=?").run(msg,row.id);db.exec("COMMIT");
    }
  }
}
export interface Transport{send(owner:string,id:string,card:ReturnType<typeof renderCard>):Promise<string>;update(message:string,card:ReturnType<typeof renderCard>):Promise<void>}
export async function notify(mode:Mode,owner:string,transport:Transport,link=mode==="mock"?"模拟传输":"未确认"){
  const db=cardDb();
  try{
    db.exec("BEGIN IMMEDIATE");collect(db,mode,owner);db.prepare("UPDATE fs_notify SET heartbeat=?,link=? WHERE mode=?").run(Date.now(),link,mode);db.exec("COMMIT");applyPending(db,mode,owner);
    for(const row of db.prepare("SELECT * FROM fs_outbox WHERE mode=? AND owner=? AND delivery IN ('pending','sent')").all(mode,owner)){
      const c:Card=JSON.parse(String(row.card));if(!cardEnabled(db,mode,c)||(mode==="live"&&process.env.FEISHU_CARD_PILOT_TASK&&(c.task!==process.env.FEISHU_CARD_PILOT_TASK||c.kind!=="choice"||c.binding!==process.env.FEISHU_CARD_PILOT_BINDING)))continue;
      if(c.kind==="morning"&&c.day!==cruiseDay()){
        if(row.delivery==="pending")db.prepare("UPDATE fs_outbox SET delivery='expired' WHERE id=?").run(row.id);
        continue;
      }
      let result=String(row.result);
      if(c.kind==="retro"&&!result&&getRetros(db,{task:c.task,version:c.version}).length){
        result="复盘已登记";
        db.prepare("UPDATE fs_outbox SET result=? WHERE id=?").run(result,row.id);
      }
      const resolving=c.kind!=="retro"&&c.task&&resolvedOnWeb(db,c.task,c.version)&&(!result||result===deferred||result.includes("过期")||result==="决定已接收");
      if(resolving){
        result=resolvedInWorkbench;
        db.prepare("UPDATE fs_outbox SET result=? WHERE id=?").run(result,row.id);
      }else if(c.task&&c.kind!=="handoff"&&c.kind!=="retro"&&(!result||result===deferred)&&!valid(db,c,String(row.id))){result="版本或任务已变化，卡片已过期";db.prepare("UPDATE fs_outbox SET result=? WHERE id=?").run(result,row.id);}
      if(!row.message&&result){db.prepare("UPDATE fs_outbox SET delivery='expired' WHERE id=? AND delivery='pending'").run(row.id);continue;}
      const body=renderCard(String(row.id),c,result),digest=hash(body);
      if(row.sentHash===digest||!db.prepare("UPDATE fs_outbox SET delivery='unknown' WHERE id=? AND delivery=? AND card=? AND result=?").run(row.id,row.delivery,row.card,result).changes)continue;
      try{
        const message=row.message?String(row.message):await transport.send(owner,String(row.id),body);
        if(row.message)await transport.update(message,body);
        db.prepare("UPDATE fs_outbox SET delivery='sent',message=?,sentHash=? WHERE id=?").run(message,digest,row.id);
      }catch{
        // A resolve retries an idempotent replacement of the same message.
        if(row.message&&result===resolvedInWorkbench)db.prepare("UPDATE fs_outbox SET delivery='sent' WHERE id=?").run(row.id);
      }
    }
  }finally{db.close();}
}
export function mockTransport():Transport{return {
  async send(_owner,id,body){const db=cardDb();try{const message="mock-"+id;db.prepare("INSERT OR IGNORE INTO fs_sim_messages VALUES(?,?,?)").run(message,JSON.stringify(body),id);return message;}finally{db.close();}},
  async update(id,body){const db=cardDb();try{db.prepare("UPDATE fs_sim_messages SET body=? WHERE id=?").run(JSON.stringify(body),id);}finally{db.close();}}
};}
