import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {chromium} from "playwright";

const base=process.env.STUDIO_V1_URL||"http://127.0.0.1:3828",folder=process.env.STUDIO_V1_EVIDENCE;
if(!folder)throw Error("请设置 STUDIO_V1_EVIDENCE");
await mkdir(folder,{recursive:true});
const api=async(path,payload)=>{
  const response=await fetch(base+path,payload?{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify(payload)}:undefined);
  const value=await response.json();if(!response.ok)throw Error(response.status+" "+path+" "+JSON.stringify(value));return value;
};
async function wait(read,predicate,ms=195000){
  const until=Date.now()+ms;
  do{try{const value=await read();if(predicate(value))return value;}catch{}await new Promise(resolve=>setTimeout(resolve,600));}while(Date.now()<until);
  throw Error("未到期望状态");
}
const cruise=()=>api("/api/autopilot"),prod=p=>api("/api/production",p);
assert.equal((await prod()).mode,"离线示例");
const result={build:(await api("/api/version")).build,base};
const browser=await chromium.launch({channel:"msedge",headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:"Asia/Shanghai"});
const page=await context.newPage();page.setDefaultTimeout(15000);
try{
  await page.goto(base+"/studio/settings/doctor");
  await page.getByRole("button",{name:"运行本机探活"}).click();
  await page.getByRole("heading",{name:"主模型 通过"}).waitFor();
  await page.getByRole("heading",{name:"轻量模型 通过"}).waitFor();
  await page.getByRole("heading",{name:"本地 Python BGE 模拟"}).waitFor();
  result.doctor=await api("/api/readiness",{});
  await page.screenshot({path:folder+"/01-doctor.png",fullPage:true});
  await page.goto(base+"/studio/settings/governance");
  await page.getByRole("heading",{name:"事实幻觉拦截"}).waitFor();
  result.evaluation=await api("/api/readiness?evaluation=1");
  assert.deepEqual(result.evaluation.metrics.map(m=>m.full.total),[3,2,3,3]);
  await page.screenshot({path:folder+"/02-governance.png",fullPage:true});
  const calibration=body=>api("/api/calibration",body);
  await page.goto(base+"/studio/settings/autopilot");
  await page.getByRole("button",{name:"模拟夜间巡航"}).click();
  const screened=await wait(cruise,x=>x.run?.status==="submitted");
  assert.equal(screened.automation.matchMin,75);
  assert(screened.screens.some(row=>row.title.includes("初筛排除")&&row.score===25));
  assert(!screened.items.some(row=>row.title.includes("初筛排除")));
  await calibration({action:"seed"});
  await calibration({action:"propose",account:"calibration-demo",focus:"结构"});
  await calibration({action:"wake",task:"db4f1600-c301-4148-af40-000000000006",version:7});
  const morning=await wait(cruise,x=>x.cards.some(card=>card.card.kind==="morning-item"&&card.delivery==="sent"));
  const good=morning.items.find(row=>row.candidate?.score>=85&&!row.candidate.disagreements.length);
  const card=morning.cards.find(row=>row.card.task===good.taskId&&row.card.kind==="morning-item");
  const before=await api("/api/articles?taskId="+good.taskId);
  const decision={action:"decision",card:card.id,message:card.message,decision:"approve"};
  await api("/api/autopilot",decision);await api("/api/autopilot",decision);
  const ready=await wait(()=>api("/api/readiness"),rows=>rows.find(row=>row.label==="已派生待发三端包").count===1);
  const channelVersions=await Promise.all(["xiaohongshu","douyin-script","douyin-post","wechat"].map(variant=>
    api("/api/derivations?"+new URLSearchParams({taskId:good.taskId,articleVersion:good.candidate.articleVersion,variant}))));
  assert(channelVersions.every(row=>row.revision===1));
  assert.deepEqual(await api("/api/articles?taskId="+good.taskId),before);
  result.fastlane={task:good.taskId,version:good.candidate.articleVersion,revision:channelVersions.map(row=>[row.content.variant,row.revision]),motherUnchanged:true};
  const costs=await cruise();
  assert(costs.budget.spent>=1000);
  await api("/api/autopilot",{action:"automation",policy:{matchMin:75,dailyMicros:1000}});
  const halted=await wait(cruise,x=>x.budget.paused&&x.cards.some(row=>row.card.kind==="budget"&&row.delivery==="sent"));
  assert.equal(halted.cards.filter(row=>row.card.kind==="budget").length,1);
  result.budget={before:costs.budget,after:halted.budget,screens:screened.screens};
  await page.goto(base+"/");
  await page.getByRole("heading",{name:"今日统一作战台"}).waitFor();
  await page.getByRole("link",{name:/1 已派生待发三端包/}).waitFor();
  await page.screenshot({path:folder+"/03-daily-desk.png",fullPage:true});
  result.desk=ready;
  const author=await prod({action:"entity",kind:"account",value:{id:"v1-series",version:0,status:"启用",name:"写作连载演练",platform:"小红书"}});
  const title="离线专题练习：如何辨认一条观察";
  const draft=episode=>prod({action:"draft",value:{id:randomUUID(),version:0,account:author.id,platform:author.platform,
    topic:title,kind:"图文",intent:"queued",budgetProfile:"local_extended",series:{label:"观察手册",episode}}});
  const submit=async draft=>prod({action:"batch",id:randomUUID(),drafts:[draft],preview:await prod({action:"preview",drafts:[draft]}),requestLimit:32,tokenLimit:120000});
  const first=await submit(await draft(1));
  const article=await wait(()=>api("/api/articles?taskId="+first.firstTask),x=>!!x.head);
  const final=await api("/api/articles",{action:"publish",taskId:first.firstTask,baseVersion:article.head.version,revision:0,title:article.head.title,document:article.head.document});
  const continuation=await draft(2),matches=await prod({action:"matrix",drafts:[continuation]});
  assert(!matches[0].some(row=>row.id===first.firstTask));
  const next=await submit(continuation),detail=await api("/api/tasks?id="+next.firstTask);
  assert.equal(detail.input.production.seriesSources[0].version,final.head.version);
  result.series={first:first.firstTask,second:next.firstTask,frozen:detail.input.production.seriesSources[0]};
  await writeFile(folder+"/readiness.json",JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify({build:result.build,fastlane:result.fastlane.task,series:result.series.second,evidence:folder}));
}finally{await browser.close();}
