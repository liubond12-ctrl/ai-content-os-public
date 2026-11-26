import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {chromium} from "playwright";

const base=process.env.STUDIO_SPRINT5_URL||"http://127.0.0.1:3788";
const folder=process.env.STUDIO_SPRINT5_EVIDENCE;
if(!folder)throw Error("请设置 STUDIO_SPRINT5_EVIDENCE");
await mkdir(folder,{recursive:true});
const api=(path,body)=>fetch(base+path,body?{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify(body)}:undefined);
async function json(path,body){
  const r=await api(path,body),result=await r.json();if(!r.ok)throw Error(JSON.stringify(result));
  return result;
}
const production=body=>json("/api/production",body);
const getArticle=id=>json("/api/articles?taskId="+id);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(read,ok,timeout=180000){
  const until=Date.now()+timeout;
  do{try{const value=await read();if(ok(value))return value;}catch{}await pause(450);}while(Date.now()<until);
  throw Error("未等到离线任务："+JSON.stringify(await production()));
}
assert.equal((await production()).mode,"离线示例");
const evidence={build:(await json("/api/version")).build,base};
const topic="纸角叙述对照｜从动作开始 "+randomUUID().slice(0,8);
const accounts=await Promise.all([["matrix-papercut","纸角观察","小红书"],["matrix-pages","纸面记录","公众号"]].map(([id,name,platform])=>
  production({action:"entity",kind:"account",value:{id,name,platform,status:"启用",version:0}})));
for(const [id,name,body,constraintValue,hard] of [["track-first","短句","用一个可见动作开头","动作",true],
  ["track-repeat","重复短句","用一个可见动作开头","动作",true],["track-contrast","概述","用概述开头","概述",false]]){
  await production({action:"entity",kind:"rule",value:{id,name,body,constraintKey:"开头",constraintValue,hard,status:"启用",version:0}});
}
const drafts=await Promise.all(accounts.map(account=>production({action:"draft",value:{id:randomUUID(),version:0,account:account.id,
  platform:account.platform,topic,kind:"图文",intent:"queued",sources:["scene-editing@1"],budgetProfile:"local_extended",
  chapters:["起点","证据","复盘"].map((part,index)=>({id:"chapter-"+index,heading:account.name+part}))}})));
const request=async draft=>({action:"batch",id:randomUUID(),drafts:[draft],
  preview:await production({action:"preview",drafts:[draft]}),tokenLimit:120000,requestLimit:32});
const previews=await Promise.all(drafts.map(request));
const concurrent=await Promise.all(previews.map(body=>api("/api/production",body)));
assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
const won=concurrent.findIndex(r=>r.ok),lost=1-won,{firstTask:first}=await concurrent[won].json();
const hits=(await production({action:"matrix",drafts:[drafts[lost]]}))[0];
assert(hits.some(row=>row.id===first&&row.signals.includes("标题")));
const experiment=await production({action:"draft",value:{...drafts[lost],experiment:"测试同题的两种账号表达"}});
const {firstTask:second}=await production(await request(experiment));
evidence.matrix={concurrent:concurrent.map(r=>r.status),first,second,preflight:hits};
for(const id of [first,second])await wait(()=>json("/api/collaboration?taskId="+id),data=>data.flow?.panels?.some(panel=>panel.phase==="complete"));
const before=await getArticle(first);
assert.equal(before.head.chapters.length,3);
assert(before.head.chapters.every(section=>section.paragraphs.some(row=>row.sources.length)));
const chosen=before.head.chapters[1].id;
const revised=await json("/api/chapters",{taskId:first,version:before.head.version,revision:before.draft?.revision??0,section:chosen,feedback:"聚焦纸边的变化"});
assert(revised.draft.chapters.find(section=>section.id===chosen).paragraphs[0].text.includes("编辑要求"));
assert.deepEqual(revised.draft.document.filter(block=>block.sectionId!==chosen),before.head.document.filter(block=>block.sectionId!==chosen));
const stale=await api("/api/chapters",{taskId:first,version:before.head.version,revision:0,section:chosen,feedback:"迟到的改写"});
assert.equal(stale.status,409);
const final=await json("/api/articles",{action:"publish",taskId:first,baseVersion:before.head.version,revision:revised.draft.revision,title:revised.draft.title,document:revised.draft.document});
assert(final.head.confirmed);
assert.deepEqual(final.head.document.filter(block=>block.sectionId!==chosen),before.head.document.filter(block=>block.sectionId!==chosen));
const variant=await json("/api/derivations",{action:"generate",taskId:first,articleVersion:final.head.version,variant:"wechat",revision:0,allowCloud:false});
assert.equal(variant.content.variant,"wechat");
const trace=(await json("/api/matrix?task="+first)).trace;
assert(trace.modules.some(row=>row.duplicateOf));assert(trace.conflicts.some(row=>row.key==="开头"));
evidence.chapter={task:first,base:before.head.version,final:final.head.version,chapters:final.head.chapters.map(row=>({id:row.id,heading:row.heading,citations:row.paragraphs.flatMap(item=>item.sources)})),stale:409};
evidence.assembly=trace;

const browser=await chromium.launch({channel:"msedge",headless:true});
const context=await browser.newContext({viewport:{width:1440,height:950},permissions:["clipboard-read","clipboard-write"]});
const page=await context.newPage();
try{
  const packageUrl=base+"/production/package?id="+first;
  await page.goto(packageUrl);
  const preview=page.getByLabel("图位预览，可粘贴或拖入图片");
  await page.getByRole("img",{name:"线框占位"}).waitFor();
  await page.getByLabel("目标预览").selectOption("抖音");
  await page.getByText("1/3 · 9:16",{exact:true}).waitFor();
  const aspect=await preview.evaluate(node=>node.clientWidth/node.clientHeight);
  assert(Math.abs(aspect-9/16)<.02);
  await page.screenshot({path:folder+"/00-wireframe.png",fullPage:true});
  await page.getByLabel("目标预览").selectOption("公众号");
  await page.getByText("1/3 · 头图 · 2.35:1",{exact:true}).waitFor();
  await page.getByRole("button",{name:"复制 image2 提示词"}).click();
  await page.getByText("已复制 image2 提示词",{exact:true}).waitFor();
  assert((await page.evaluate(()=>navigator.clipboard.readText())).includes("2.35:1"));
  await page.getByLabel("目标预览").selectOption("小红书");
  await page.getByText("1/3 · 3:4",{exact:true}).waitFor();
  await page.getByLabel("我有权使用图片").check();
  const pixel="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Vv3sAAAAASUVORK5CYII=";
  const event=kind=>preview.evaluate((node,{kind,pixel})=>{
    const data=new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(pixel),char=>char.charCodeAt(0))],"纸角.png",{type:"image/png"}));
    node.dispatchEvent(kind==="paste"?new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true}):
      new DragEvent("drop",{dataTransfer:data,bubbles:true,cancelable:true}));
  },{kind,pixel});
  await event("paste");
  await page.getByRole("button",{name:"确认当前图位"}).click();
  await page.getByText("已确认图位",{exact:true}).waitFor();
  await page.getByRole("button",{name:"下一图"}).click();
  await event("drop");
  await page.getByRole("button",{name:"确认当前图位"}).click();
  await page.getByText("已确认图位",{exact:true}).waitFor();
  const imageState=await json("/api/production/package?id="+first);
  const confirmed=imageState.images.filter(row=>row.confirmed&&row.article===final.head.version);
  assert.deepEqual(confirmed.map(row=>row.page),[1,2]);
  const staleImage=await api("/api/production/package",{task:first,page:2,article:final.head.version,asset:confirmed[1].asset,confirmed:true,expected:0});
  assert.equal(staleImage.status,409);
  const exported=await api("/api/production/package?id="+first+"&download=1");
  assert(exported.ok,await exported.clone().text());const zip=Buffer.from(await exported.arrayBuffer()),entries=[];
  let at=0;
  while(zip.readUInt32LE(at)===0x04034b50){
    const width=zip.readUInt16LE(at+26),size=zip.readUInt32LE(at+18),start=at+30;
    entries.push(zip.toString("utf8",start,start+width));at=start+width+size;
  }
  assert.deepEqual(entries,["正文.md","图片/1-v2-纸角.png","图片/2-v2-纸角.png","清单.json"]);
  await writeFile(folder+"/内容包.zip",zip);
  await page.screenshot({path:folder+"/01-storyboard.png",fullPage:true});
  evidence.storyboard={packageUrl,entries,staleImage:staleImage.status,delivery:["paste","drop"]};
  await page.goto(base+"/studio/settings/matrix");
  await page.getByLabel("左侧账号稿件").selectOption(first);
  await page.getByLabel("右侧账号稿件").selectOption(second);
  await page.getByRole("region",{name:"左侧",exact:true}).getByRole("heading",{name:/纸角叙述对照/}).waitFor();
  await page.getByRole("region",{name:"右侧",exact:true}).getByRole("heading",{name:/纸角叙述对照/}).waitFor();
  await page.getByLabel("左侧文章版本").selectOption(String(before.head.version));
  await page.getByLabel("左侧文章版本").selectOption(String(final.head.version));
  await page.getByText("查看文字差异",{exact:true}).click();
  await page.screenshot({path:folder+"/02-matrix.png",fullPage:true});
  await page.goto(base+"/studio/editor?taskId="+first+"&distribution=1");
  const drawer=page.getByRole("dialog",{name:"三端一键分发"});
  await drawer.getByRole("button",{name:"公众号",exact:true}).click();
  await drawer.locator(".channel-radar summary").click();
  await drawer.getByText(/搜索与问答可读性 · \d\/4/).waitFor();
  evidence.geo=await drawer.getByText(/搜索与问答可读性 · \d\/4/).textContent();
  await page.screenshot({path:folder+"/03-geo.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.goto(packageUrl);
  await page.getByLabel("目标预览").waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:folder+"/04-narrow.png",fullPage:true});
  await writeFile(folder+"/acceptance.json",JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify({build:evidence.build,first,second,evidence:folder}));
}finally{await browser.close();}
