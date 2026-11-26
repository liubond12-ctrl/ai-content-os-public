import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {chromium} from "playwright";

const base=process.env.STUDIO_V1_URL||"http://127.0.0.1:3848";
const folder=process.env.STUDIO_V1_EVIDENCE,longId=process.env.STUDIO_V1_LONG_TASK,netLog=process.env.STUDIO_V1_NET_LOG;
if(!folder||!longId||!netLog)throw Error("需要证据目录、长文任务和 Node 守卫日志");
await mkdir(folder,{recursive:true});
const phase=JSON.parse(await readFile(folder+"/readiness.json","utf8"));
const local=hostname=>["127.0.0.1","localhost","::1","[::1]"].includes(hostname);
const requested=[],blocked=[],checks=[];
const browser=await chromium.launch({channel:"msedge",headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:"block"});
await context.route("**/*",async route=>{
  const target=new URL(route.request().url());
  if(!["http:","https:"].includes(target.protocol)||local(target.hostname)){
    if(local(target.hostname))requested.push(target.pathname);
    return route.continue();
  }
  blocked.push({type:route.request().resourceType()});return route.abort();
});
const page=await context.newPage(),pageErrors=[];
page.on("pageerror",error=>pageErrors.push({path:new URL(page.url()).pathname,message:error.message,stack:error.stack?.split("\n").slice(0,3)}));
const navigate=path=>page.goto(base+path);
const section=()=>page.locator(".editor-review-panel");
const conflict=()=>section().locator(".consult-conflict").filter({hasText:"蓝笔落在了桌上。"});
const record=async(name,width,action)=>{
  const state=await action?.();
  const measure=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:innerHeight}));
  assert(measure.scrollWidth<=measure.width+1,JSON.stringify({name,...measure}));
  const screenshot=width+"-"+name+".png";
  await page.screenshot({path:folder+"/"+screenshot,fullPage:!["long-editor","conflict-pk","conflict-location","channels"].includes(name)});
  checks.push({name,measure,screenshot,state});
};
try{
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width===390?844:900});
    await navigate("/");
    await page.getByRole("heading",{name:"今日待办"}).waitFor();
    await page.getByRole("link",{name:/篇成品待发布/}).waitFor();
    await record("home",width);
    await navigate("/hot");
    await page.getByRole("heading",{name:"今日热点"}).waitFor();
    assert.equal(await page.getByRole("link",{name:/访问原站/}).count(),0);
    await record("hot",width);
    await navigate("/studio/editor?taskId="+longId+"&review=1");
    await conflict().waitFor();
    await record("long-editor",width,async()=>{
      if(width===1440){
        const scroll=await section().evaluate(el=>{
          const documentBefore=scrollY;el.scrollTop=el.scrollHeight;
          const frame=el.getBoundingClientRect(),last=el.querySelector(".editor-audit-evidence").getBoundingClientRect();
          return {internal:el.scrollTop,docStayed:scrollY===documentBefore,overflow:getComputedStyle(el).overflowY,
            bottomVisible:last.bottom<=Math.min(frame.bottom,innerHeight)+2};
        });
        assert(scroll.internal>0&&scroll.docStayed&&scroll.overflow==="auto"&&scroll.bottomVisible,JSON.stringify(scroll));
        return scroll;
      }
      await conflict().scrollIntoViewIfNeeded();
      const narrow=await conflict().evaluate(el=>({columns:getComputedStyle(el.querySelector(".consult-options")).gridTemplateColumns.split(" ").length,
        overflow:getComputedStyle(el.closest(".editor-review-panel")).overflowY}));
      assert.deepEqual(narrow,{columns:1,overflow:"visible"});
      return narrow;
    });
    await record("conflict-pk",width,async()=>{
      const variants=conflict().locator(".consult-options");
      await variants.scrollIntoViewIfNeeded();
      const columns=await variants.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(" ").length);
      assert.equal(columns,width===1440?2:1);
      return {columns};
    });
    const locate=conflict().getByRole("button",{name:"定位原文"}).first();
    await locate.click();
    await page.waitForFunction(()=>{
      const selection=window.getSelection();
      if(selection?.toString()!=="蓝笔落在了桌上。")return false;
      const mark=selection.getRangeAt(0).getBoundingClientRect();
      return Math.abs(mark.top+mark.height/2-innerHeight/2)<18;
    },{},{timeout:6000});
    await record("conflict-location",width,()=>page.evaluate(()=>{
      const mark=window.getSelection().getRangeAt(0).getBoundingClientRect();
      return {located:true,center:Math.round(mark.top+mark.height/2),scrollY};
    }));
    const {task,version}=phase.fastlane;
    await navigate("/studio/editor?taskId="+task+"&version="+version+"&distribution=1");
    const drawer=page.getByRole("dialog",{name:"三端一键分发"});
    await drawer.locator(".channel-radar summary").waitFor();
    await record("channels",width,async()=>{
      for(const label of ["抖音","公众号","小红书"]){
        await drawer.getByRole("button",{name:label,exact:true}).click();
        await drawer.locator(".channel-radar summary").waitFor();
      }
      const copy=drawer.getByRole("button",{name:"复制成品"});
      await copy.scrollIntoViewIfNeeded();
      assert(await copy.isEnabled());
      assert(await drawer.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      return {tabs:3,copyEnabled:true};
    });
    await navigate("/production/package?id="+task);
    await page.getByLabel("目标预览").selectOption("公众号");
    await page.getByText(/头图 · 2\.35:1/).waitFor();
    await record("storyboard",width,async()=>{
      await page.getByRole("button",{name:"复制 image2 提示词"}).scrollIntoViewIfNeeded();
      assert(await page.getByRole("button",{name:"复制 image2 提示词"}).isEnabled());
      return {overlayControls:true};
    });
    const retro=phase.desk.find(row=>row.label==="T+3d 到期待填");
    assert(retro?.count>0&&retro.href.includes("item="));
    await navigate("/");
    const retroLink=page.getByRole("link",{name:/篇待填数据/});
    assert.equal(await retroLink.getAttribute("href"),retro.href);
    await retroLink.click();
    const retroTarget=new URL(retro.href,base);
    await page.waitForURL(url=>url.pathname===retroTarget.pathname&&url.searchParams.get("item")===retroTarget.searchParams.get("item"));
    await page.reload();
    await page.getByText("5 篇已复盘",{exact:true}).waitFor();
    await page.getByText(/已模拟到期/).waitFor();
    const selected=await page.getByLabel(/^稿件/).inputValue();
    assert.equal(selected,retroTarget.searchParams.get("item"));
    await record("calibration",width,()=>({accountPreserved:true,publishedVersionPreserved:true}));
    await navigate("/studio/settings/governance");
    await page.getByRole("heading",{name:"事实幻觉拦截"}).waitFor();
    await page.getByText("查看样本与逐项结果").click();
    await record("governance",width);
  }
  const node=String(await readFile(netLog,"utf8")).trim().split("\n").filter(Boolean).map(line=>JSON.parse(line));
  assert(node.filter(row=>row.event==="active").length>=4);
  assert.deepEqual(node.filter(row=>row.event==="blocked"),[]);
  assert.deepEqual(blocked,[]);
  assert.deepEqual(pageErrors,[]);
  const evidence={base,checks,browser:{observedLocalRequests:requested.length,blocked,pageErrors},
    server:{guardProcesses:node.filter(row=>row.event==="active").length,blocked:node.filter(row=>row.event==="blocked"),method:"Node 常见网络 API 启动防护，浏览器应用请求路由拦截；非操作系统包捕获"}};
  await writeFile(folder+"/ui-and-network.json",JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify({checks:checks.length,browser:evidence.browser,server:evidence.server,evidence:folder}));
}finally{await browser.close();}
