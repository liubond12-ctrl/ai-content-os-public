import {createHash,randomUUID} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import type {Flow} from "./collaboration";
import type {ArticleState} from "./article-store";
import {breakoutReferences} from "./library";
import {entities} from "./production-db";
import {getPrediction,getPublication,effectiveDue,getRetros,samplePool,calibrationTables} from "./calibration";
import type {AtomicBrick,BrickPin,VersionKey} from "../types/calibration";

type Extract={account:string;kind:AtomicBrick["kind"];text:string;tags:string[]};
function insert(db:DatabaseSync,input:Extract,source:AtomicBrick["source"],winRate:number|null){
  const {text,tags,account,kind}=input;
  if(!entities(db,"account").some(row=>row.id===account&&row.status==="启用"))throw Error("请先选择启用账号");
  const hash=createHash("sha256").update(JSON.stringify([account,kind,text,source.id,source.version,source.kind])).digest("hex");
  const existing=db.prepare("SELECT payload FROM cal_bricks WHERE fingerprint=?").get(hash);
  if(existing)return JSON.parse(String(existing.payload)) as AtomicBrick;
  const brick:AtomicBrick={id:randomUUID(),version:1,account,kind,text,tags,source,winRate};
  db.prepare("INSERT INTO cal_bricks VALUES(?,?,?,?,?)").run(brick.id,brick.version,account,hash,JSON.stringify(brick));
  return brick;
}
export function extractArticleBrick(db:DatabaseSync,key:VersionKey,state:ArticleState,input:Extract){
  const snapshot=state.versions.find(row=>row.version===key.version),prediction=getPrediction(db,key);
  const retro=getRetros(db,key).at(-1),publication=getPublication(db,key);
  if(!snapshot?.confirmed||snapshot.origin!=="human"||!prediction||prediction.account!==input.account||prediction.score<80||!retro?.beat||
    !publication||Date.parse(retro.observedAt)<Date.parse(effectiveDue(publication)))throw Error("素材须来自本账号跑赢预测、已复盘且达到 80 分的人工定稿");
  if(!snapshot.body.includes(input.text)&&!snapshot.title.includes(input.text))throw Error("积木须逐字对应来源正文或标题");
  if(input.kind==="真实案例"){
    const row=db.prepare("SELECT payload FROM collaboration WHERE task=?").get(key.task);
    const flow:Flow|null=row?JSON.parse(String(row.payload)):null;
    const checked=flow?.panels?.filter(panel=>panel.articleVersion===key.version&&panel.phase==="complete")
      .flatMap(panel=>panel.reviews.flatMap(review=>review.result.facts.checks));
    if(!checked?.some(check=>check.status==="来源原文匹配"&&check.quote===input.text)||/虚构示例|原创虚构|假设情景|模拟案例/.test(snapshot.body)||/虚构|假设|模拟/.test(input.text))
      throw Error("真实案例须来自该版通过来源核验的原句");
  }
  const pool=samplePool(db,input.account);
  return insert(db,input,{kind:"article",id:key.task,version:key.version,title:snapshot.title},pool.filter(row=>row.retro.beat).length/pool.length);
}
function breakout(id:string,version:number){
  return breakoutReferences().find(row=>row.id===id&&row.version===version);
}
export function extractReferenceBrick(db:DatabaseSync,id:string,version:number,input:Extract){
  const ref=breakout(id,version);
  if(!ref)throw Error("仅可从明确标为爆款且仍获准使用的参考版本萃取");
  if(input.kind==="真实案例"){
    if(ref.synthetic!==false||!ref.tags.includes("真实案例")||!ref.facts?.includes(input.text)||/虚构|假设|模拟/.test(input.text))
      throw Error("参考库未明确标记并记录该真实案例");
  }else if(![ref.title,ref.method,ref.content].some(value=>value.includes(input.text)))throw Error("积木须对应参考库原文");
  return insert(db,input,{kind:"reference",id,version,title:ref.title},null);
}
function authorized(db:DatabaseSync,brick:AtomicBrick,account:string){
  if(brick.account!==account)return false;
  if(brick.source.kind==="reference")return !!breakout(brick.source.id,brick.source.version);
  return !!getRetros(db,{task:brick.source.id,version:brick.source.version}).at(-1)?.beat;
}
export function searchBricks(db:DatabaseSync,account:string,query=""){
  calibrationTables(db);
  if(!account||!entities(db,"account").some(row=>row.id===account&&row.status==="启用"))return [];
  const needle=query.trim().toLocaleLowerCase();
  return db.prepare("SELECT payload FROM cal_bricks WHERE account=? ORDER BY rowid DESC").all(account)
    .map(row=>JSON.parse(String(row.payload)) as AtomicBrick)
    .filter(row=>[row.kind,row.text,row.source.title,...row.tags].some(text=>text.toLocaleLowerCase().includes(needle))&&authorized(db,row,account)).slice(0,40);
}
export function freezeBricks(db:DatabaseSync,account:string,pins:readonly BrickPin[]){
  if(!pins.length)return [];
  calibrationTables(db);
  if(!entities(db,"account").some(row=>row.id===account&&row.status==="启用"))throw Error("账号已停用，不能使用素材积木");
  const seen=new Set<string>();
  return pins.map(pin=>{
    if(seen.has(pin.id))throw Error("素材积木选择重复");
    seen.add(pin.id);
    const row=db.prepare("SELECT payload FROM cal_bricks WHERE id=? AND version=? AND account=?").get(pin.id,pin.version,account);
    const brick:AtomicBrick|null=row?JSON.parse(String(row.payload)):null;
    if(!brick||!authorized(db,brick,account))throw Error("素材积木版本或授权已变化，请重新选择");
    return brick;
  });
}
