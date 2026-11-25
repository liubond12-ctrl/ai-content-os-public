import {createHash} from "node:crypto";
import {catalog} from "./safe-demo-catalog";
import {writerBrief} from "./writability";
import type {Task} from "./tasks";
import type {AssemblyResult} from "../context/types";
import {retrieve, fuse, SEMANTIC_THRESHOLD, type Chunk, type Hit, type Mode} from "../rag/search";
import {embed, cosine, MODEL} from "../rag/embedding";

const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
export const approvalHash=hash(JSON.stringify(catalog));
export class SafetyError extends Error {}
export function refuse():never {throw new SafetyError("安全阻塞：环境、输入、资料来源或人工审核状态不符合要求");}
export function safeInput(scenario:keyof typeof catalog.scenarios){
  return {environment:"safe-demo" as const,scenario,persona:"demoa" as const,
    ...catalog.scenarios[scenario],reference:"",mode:"keyword" as const,generate:true};
}
export function checkInput(t:Task){
  if(t.input.environment!=="safe-demo" || !t.input.scenario)refuse();
  const expected=safeInput(t.input.scenario);
  for(const key of ["persona","topic","audience","reference"] as const)
    if(t.input[key]!==expected[key])refuse();
}
export function safeKnowledge(){
  const chunks:Chunk[]=catalog.documents.map(d=>({
    id:"safe-demo:"+d.id,path:"safe-demo/v2/"+d.id+".txt",heading:d.title,text:d.text,
    sha256:hash(d.text),location:"独立测试全文",offset:0,persona:"shared",personaReason:"独立虚构测试资料",
    kind:d.kind,kindReason:"测试资料作者指定",verified:false,publicationDate:null,tags:[],
    sources:[{path:"safe-demo/v2/"+d.id+".txt",modifiedAt:0,associatedPersonas:["safe-demo"]}],
    temporal:{status:"unknown",publicationDate:"unknown",applicableDate:"仅用于虚构表达练习",
      dateMentions:[],reason:"无现实事实验证"}
  }));
  return {chunks,files:chunks.map(c=>({path:c.path,status:"indexed",chunks:1}))};
}
export function safeAssembly(t:Task):AssemblyResult{
  checkInput(t);
  const field=<T>(value:T)=>({value,source:"explicit" as const,status:"confirmed" as const,editable:false,rationale:"safe-demo 固定测试配置"});
  const compiledContext=catalog.rules;
  return {compiledContext,manifest:{version:"phase1-v1",input:{...t.input,persona:"demoa"},
    resolvedConfig:{persona:field("demoa"),topic:field(t.input.topic),contentGoal:field("信任"),
      riskLevel:field("低风险"),includeImageText:field(false),bodyLength:field(600),
      testVariable:field(null),additionalConstraints:field(t.input.audience)},
    loadedModules:[{id:"safe-demo-rules",label:catalog.account,path:"safe-demo/v2/rules",semanticLayer:"system",priority:100,
      sha256:hash(compiledContext),bytes:Buffer.byteLength(compiledContext),reason:"独立测试规则"}],
    skippedModules:[],conflicts:[],contextCharacters:compiledContext.length,
    tokenEstimate:{value:compiledContext.length,method:"cjk-plus-latin-heuristic",isEstimate:true},assemblyHash:hash(compiledContext)}};
}
export async function safeRetrieve(query:string,mode:Mode){
  const start=performance.now(), kb=safeKnowledge();
  const base=retrieve(kb.chunks,query,"shared");
  if(mode==="keyword")return {...base,elapsedMs:performance.now()-start,model:null};
  const q=await embed(query,true);
  // Small independent in-memory index, never reads business vectors.json.
  const scored=await Promise.all(kb.chunks.map(async c=>({...c,score:cosine(q,await embed(c.heading+"\n"+c.text))})));
  const semantic:Hit[]=scored.filter(c=>c.score>=SEMANTIC_THRESHOLD).sort((a,b)=>b.score-a.score)
    .map((c,i)=>({...c,similarity:c.score,semanticRank:i+1,finalRank:i+1}));
  const hits=mode==="semantic"?semantic:fuse(base.hits,semantic);
  return {...base,mode,hits:hits.slice(0,5),elapsedMs:performance.now()-start,model:MODEL};
}
function checkEvidence(evidence:unknown){
  if(!Array.isArray(evidence))refuse();
  const known=safeKnowledge().chunks;
  for(const candidate of evidence){
    if(!candidate || typeof candidate!=="object")refuse();
    const source=known.find(c=>c.id===candidate.id);
    if(!source)refuse();
    for(const [key,value] of Object.entries(source))
      if(JSON.stringify(candidate[key])!==JSON.stringify(value))refuse();
    const allowed=new Set([...Object.keys(source),"score","keywordRank","keywordScore","semanticRank","similarity","finalRank"]);
    if(Object.keys(candidate).some(k=>!allowed.has(k)))refuse();
    for(const key of ["score","keywordRank","keywordScore","semanticRank","similarity","finalRank"])
      if(candidate[key]!==undefined && (typeof candidate[key]!=="number" || !Number.isFinite(candidate[key])))refuse();
  }
}
export function preflight(t:Task){
  checkInput(t);
  if(t.context && JSON.stringify(t.context)!==JSON.stringify(safeAssembly(t)))refuse();
  if(t.result)checkEvidence(t.result.retrieval.hits);
  if(t.research){
    checkEvidence(t.research.evidence);
    const expected=t.research.evidence.map(h=>({id:h.id,category:h.kind,excerpt:h.text,verified:h.verified,
      applicableDate:h.temporal.applicableDate,status:h.temporal.status}));
    if(JSON.stringify(t.research.sourceAssessments)!==JSON.stringify(expected))refuse();
  }
  return {environment:"safe-demo",dataset:catalog.dataset,approvalHash,approved:process.env.STUDIO_SAFE_DEMO_APPROVED_SHA256===approvalHash,
    account:catalog.account,rules:catalog.rules,scenarios:catalog.scenarios,
    sources:safeKnowledge().chunks.map(c=>({id:c.id,path:c.path,kind:c.kind,sha256:c.sha256,summary:c.text}))};
}
export function checkOutbound(t:Task,data:unknown){
  const review=preflight(t);
  if(!review.approved)refuse();
  const payload=data as {input?:unknown;evidence?:unknown;rules?:unknown;research?:unknown};
  if(!payload || JSON.stringify(payload.input)!==JSON.stringify(t.input))refuse();
  if(t.stage==="research"){
    if(Object.keys(payload).some(k=>!["input","lastRound","evidence"].includes(k)))refuse();
    checkEvidence(payload.evidence);
  }else if(t.stage==="write"){
    if(Object.keys(payload).some(k=>!["input","rules","research"].includes(k)))refuse();
    if(!t.research || payload.rules!==catalog.rules || JSON.stringify(payload.research)!==JSON.stringify(writerBrief(t.research)))refuse();
    const passages=writerBrief(t.research).supported;
    for(const s of passages)if(!t.research.evidence.some(h=>h.id===s.sourceId && h.kind!=="production-sop" && !!s.quote && h.text.includes(s.quote)))refuse();
    checkEvidence(t.research?.evidence);
  }else refuse();
  checkSecrets(data);
}
function checkSecrets(data:unknown){
  const serialized=JSON.stringify(data);
  const key=process.env.STUDIO_MODEL_KEY;
  if((key && serialized.includes(key)) || /sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+|resources\/source-pack|data\/knowledge\.json/i.test(serialized))refuse();
}
export function reviewSources(task:Task){
  return (task.research?.evidence??[]).map(h=>({id:h.id,path:h.path,location:h.location,sha256:h.sha256,text:h.text,kind:h.kind,verified:h.verified,
    current:h.temporal.status==="current-verified",applicableDate:h.temporal.applicableDate}));
}
export function checkEvalOutbound(t:Task,data:unknown){
  if(!preflight(t).approved || !t.article || t.article.researchVersion!==t.research?.version)refuse();
  const expected={request:t.input,title:t.article.title,body:t.article.body,sources:reviewSources(t),calibration:[]};
  if(JSON.stringify(expected)!==JSON.stringify(data))refuse();
  checkSecrets(data);
}
