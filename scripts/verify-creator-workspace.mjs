import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {chromium} from "playwright";

const base=process.env.STUDIO_CREATOR_URL||"http://127.0.0.1:3908";
const evidence=process.env.STUDIO_CREATOR_EVIDENCE;
if(!evidence)throw Error("请指定 STUDIO_CREATOR_EVIDENCE");
const production=await (await fetch(base+"/api/production")).json();
assert.equal(production.mode,"离线示例");
const read=async path=>(await (await fetch(base+path)).json());
const readiness=JSON.parse(await readFile(evidence+"/readiness.json","utf8"));
const channels=JSON.parse(await readFile(evidence+"/sprint2/acceptance.json","utf8"));
const phase1=JSON.parse(await readFile(evidence+"/phase1/acceptance.json","utf8"));
const task=new URL(phase1.demoUrl).searchParams.get("taskId");
await mkdir(evidence,{recursive:true});
const report={build:(await read("/api/version")).build,base,checks:[],actions:{},performance:{}};
const browser=await chromium.launch({channel:"msedge",headless:process.env.STUDIO_CREATOR_HEADED!=="1"});
const context=await browser.newContext({viewport:{width:1440,height:900},permissions:["clipboard-read","clipboard-write"],serviceWorkers:"block"});
const page=await context.newPage();
const failures=[];
page.on("pageerror",error=>failures.push({path:new URL(page.url()).pathname,message:error.message}));
await context.route("**/*",route=>new URL(route.request().url()).hostname==="127.0.0.1"?route.continue():route.abort());
const timedFrames=()=>page.evaluate(()=>new Promise(resolve=>{
  const samples=[];
  let last;
  const frame=now=>{
    if(last!==undefined)samples.push(now-last);
    last=now;
    if(samples.length===90){resolve(samples);return;}
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}));
const summarize=samples=>{
  const sorted=samples.toSorted((a,b)=>a-b);
  return {frames:samples.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],
    largest:sorted.at(-1),over25:samples.filter(duration=>duration>25).length};
};
async function snapshot(name){
  const view=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
    dark:matchMedia("(prefers-color-scheme: dark)").matches,reduced:matchMedia("(prefers-reduced-motion: reduce)").matches}));
  assert(view.scrollWidth<=view.width+1,JSON.stringify({name,...view}));
  const screenshot=[name,view.width,view.dark?"dark":"light",view.reduced?"reduced":"motion"].join("-")+".png";
  await page.screenshot({path:evidence+"/"+screenshot});report.checks.push({screenshot,...view});
}
const edit=base+"/studio/editor?taskId="+task;
const openChannel=()=>{
  const {task,version}=readiness.fastlane;
  return page.goto(base+"/studio/editor?taskId="+task+"&version="+version+"&distribution=1");
};
const conflict=()=>page.locator(".creator-collapse[data-collapsed=false] .consult-conflict").filter({hasText:"蓝笔落在了桌上。"});
try{
  await page.goto("about:blank");
  report.performance.control=summarize(await timedFrames());
  for(const scenario of [
    {width:1440,height:900,color:"light",motion:"no-preference"},
    {width:1440,height:900,color:"dark",motion:"reduce"},
    {width:390,height:844,color:"light",motion:"reduce"},
    {width:390,height:844,color:"dark",motion:"no-preference"},
  ]){
    await page.setViewportSize({width:scenario.width,height:scenario.height});
    await page.emulateMedia({colorScheme:scenario.color,reducedMotion:scenario.motion});
    await page.goto(base);
    const menu=page.getByRole("button",{name:"工作空间菜单"});
    if(await menu.isVisible())await menu.click();
    const nav=page.getByRole("navigation",{name:"工作空间"});
    assert.deepEqual(await nav.getByRole("link").allTextContents(),["今日待办","写稿与精修","历史文章","热点与巡航","账号与素材"]);
    assert.equal(await nav.getByRole("link",{name:"今日待办"}).getAttribute("aria-current"),"page");
    await page.getByRole("link",{name:/篇成品待发布/}).waitFor();
    await snapshot("today");
    const systemLink=page.getByRole("link",{name:"系统机房",exact:true});
    assert(await systemLink.evaluate(element=>{
      const box=element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
    }));
    await systemLink.click();
    await page.getByRole("heading",{name:"系统机房",exact:true}).waitFor();
    await page.getByRole("link",{name:/巡航费用与暂停上限/}).waitFor();
    await snapshot("system");
    if(await menu.isVisible())await menu.click();
    await nav.getByRole("link",{name:"写稿与精修"}).click();
    await page.getByRole("button",{name:"发送",exact:true}).waitFor();
    await snapshot("write");
    const long=new URL(channels.entries.long);long.searchParams.delete("review");
    await page.goto(base+long.pathname+long.search);
    const locate=conflict().getByRole("button",{name:"定位原文"}).first();
    await locate.waitFor();
    await conflict().scrollIntoViewIfNeeded();
    await snapshot("conflict");
    const frames=scenario.width===1440&&scenario.motion==="no-preference"?timedFrames():undefined;
    await locate.click();
    await page.waitForFunction(()=>{
      const selection=window.getSelection();
      if(selection?.toString()!=="蓝笔落在了桌上。")return false;
      const box=selection.getRangeAt(0).getBoundingClientRect();
      return Math.abs(box.top+box.height/2-innerHeight/2)<24;
    });
    if(frames)report.performance.longLocate=summarize(await frames);
    await snapshot("locate");
    await page.goto(base+"/studio/editor?taskId="+readiness.fastlane.task);
    await page.locator('.review-capsule[data-attention="clear"]').waitFor();
    assert.equal(await page.locator("#article-audit").getAttribute("open"),null);
    await openChannel();
    const tabs=page.getByRole("navigation",{name:"分发渠道"});
    for(const label of ["母稿","公众号","抖音","小红书"]){
      const button=tabs.getByRole("button",{name:label,exact:true});
      await button.click();
      assert.equal(await button.getAttribute("aria-pressed"),"true");
    }
    const drawer=page.getByRole("dialog",{name:"三端一键分发"});
    await drawer.getByRole("button",{name:"复制成品",exact:true}).click();
    await drawer.getByRole("status").filter({hasText:"已复制纯文本。"}).waitFor();
    const settings=await tabs.evaluate(el=>{
      const style=getComputedStyle(el,"::before");
      const selected=el.querySelector('[aria-pressed="true"]'),button=getComputedStyle(selected);
      const channels=value=>value.match(/[\d.]+/g).map(Number);
      const luminosity=value=>channels(value).slice(0,3).reduce((sum,component,index)=>{
        const c=component/255;
        return sum+[.2126,.7152,.0722][index]*(c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
      },0);
      const pillVisible=channels(button.backgroundColor)[3]===0;
      const actual=pillVisible?style.backgroundColor:button.backgroundColor;
      const [lighter,darker]=[luminosity(actual),luminosity(button.color)].sort((a,b)=>b-a);
      return {width:el.clientWidth,scroll:el.scrollWidth,duration:style.transitionDuration,pillVisible,contrast:(lighter+.05)/(darker+.05)};
    });
    assert(settings.scroll<=settings.width+1);
    assert(settings.pillVisible&&settings.contrast>=4.5,JSON.stringify(settings));
    report.checks.push({channelTabs:settings,width:scenario.width,theme:scenario.color,reduced:scenario.motion==="reduce"});
    assert(scenario.motion==="reduce"?parseFloat(settings.duration)<.001:settings.duration==="0.22s",JSON.stringify(settings));
    await snapshot("channels");
  }
  report.routes=[];
  for(const route of ["/hot","/articles","/production/create?mode=batch","/production/free","/production/queue","/production/tasks",
    "/production/accounts","/studio/cases","/production/rules","/production/standards","/studio/settings","/studio/settings/calibration",
    "/studio/settings/doctor","/studio/settings/governance","/studio/settings/matrix","/studio/settings/autopilot",
    "/studio/settings/feishu-cards","/studio/system/rules"]){
    const response=await page.goto(base+route);
    assert.equal(response.status(),200);
    const title=page.locator("main h1").first();
    await title.waitFor();
    const widths=await page.evaluate(()=>[innerWidth,document.documentElement.scrollWidth]);
    assert(widths[1]<=widths[0]+1,JSON.stringify({route,widths}));
    report.routes.push({route,title:await title.innerText(),widths});
  }
  await page.setViewportSize({width:1440,height:900});
  await page.emulateMedia({colorScheme:"light",reducedMotion:"no-preference"});
  await page.goto(edit);
  const replacement=conflict().getByRole("button",{name:"替换原文",exact:true}).first();
  await replacement.waitFor();
  const before=await read("/api/articles?taskId="+task);
  await page.evaluate(()=>{
    window.creatorSavedAnimations=0;
    const watch=new MutationObserver(()=>{if(document.querySelector(".creator-old-passage"))window.creatorSavedAnimations++});
    watch.observe(document.body,{childList:true,subtree:true});
  });
  await page.route("**/api/articles",route=>route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({error:"演练：保存失败，请重试"})}),{times:1});
  await replacement.click();
  await page.getByRole("alert").filter({hasText:"演练：保存失败"}).waitFor();
  assert.equal(await page.evaluate(()=>window.creatorSavedAnimations),0);
  assert.deepEqual(await read("/api/articles?taskId="+task),before);
  await replacement.click();
  await page.getByText(/查看已处理的分歧/).waitFor();
  await page.waitForFunction(()=>window.creatorSavedAnimations>0);
  const after=await read("/api/articles?taskId="+task);
  assert.equal(after.draft.reviewEdits.length,1);
  report.actions.replacement={failedUnchanged:true,committedRevision:after.draft.revision,animatedAfterSave:true};
  const ignore=page.getByRole("button",{name:"忽略建议",exact:true}).last();
  const titleState=async()=> (await read("/api/production/brief?task="+task)).suggestions.find(row=>row.key==="title").state;
  assert.equal(await titleState(),"pending");
  await ignore.click();
  await page.getByRole("button",{name:"撤销忽略"}).scrollIntoViewIfNeeded();
  await snapshot("undo");
  await page.getByRole("button",{name:"撤销忽略"}).click();
  assert.equal(await titleState(),"pending");
  await ignore.click();
  await page.getByRole("status").filter({hasText:"已忽略建议"}).waitFor();
  assert.equal(await titleState(),"skipped");
  await page.reload();
  await page.getByText("查看已处理的建议",{exact:true}).click();
  await page.getByText(/已忽略$/).waitFor();
  report.actions.dismissal={rollbackBeforeWrite:true,persistedAfterWindow:true};
  const title=after.head.title;
  await page.goto(base+"/articles?"+new URLSearchParams({q:title,samples:"1"}));
  const row=page.locator("#article-"+task);
  await row.getByText("归档稿件",{exact:true}).click();
  await row.getByRole("button",{name:"确认归档",exact:true}).waitFor();
  assert.equal(await row.getByRole("link",{name:title,exact:true}).count(),1);
  await row.getByRole("button",{name:"确认归档",exact:true}).click();
  await page.getByRole("status").filter({hasText:"已归档"}).waitFor();
  assert.equal(await row.count(),0);
  await page.getByRole("button",{name:"撤回归档",exact:true}).click();
  await row.waitFor();
  report.actions.archive={confirmation:true,restored:true};
  const imageTask=readiness.fastlane.task;
  await page.goto(base+"/production/package?id="+imageTask);
  await page.getByText("我有权使用图片",{exact:false}).click();
  await page.evaluate(async()=>{
    const canvas=document.createElement("canvas");
    canvas.width=12;canvas.height=12;
    const paint=canvas.getContext("2d");paint.fillStyle="#7474a2";paint.fillRect(0,0,12,12);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
    await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);
  });
  await page.getByRole("button",{name:"粘贴到图位"}).click();
  await page.getByRole("status").filter({hasText:"图片已回填"}).waitFor();
  await snapshot("image");
  const clear=page.getByRole("button",{name:"清空此图位"});
  page.once("dialog",dialog=>void dialog.dismiss());
  await clear.click();
  assert(await clear.isVisible());
  page.once("dialog",dialog=>void dialog.accept());
  await clear.click();
  await page.getByRole("status").filter({hasText:"已清空当前图位"}).waitFor();
  await page.getByRole("img",{name:"线框占位"}).waitFor();
  const image=await read("/api/production/package?id="+imageTask);
  assert.equal(image.images[0].asset,null);
  assert(image.images[1].asset);
  const staleClear=await fetch(base+"/api/production/package",{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},
    body:JSON.stringify({action:"clear",task:imageTask,page:1,article:image.article.version,expected:image.images[1].version})});
  assert.equal(staleClear.status,409);
  report.actions.storyboard={literalClipboardPaste:true,confirmation:true,historyPreserved:true,stale:409};
  assert.deepEqual(failures,[]);
  report.pageErrors=failures;
  await writeFile(evidence+"/creator-acceptance.json",JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({build:report.build,checks:report.checks.length,evidence,actions:report.actions,performance:report.performance}));
}finally{await browser.close();}
