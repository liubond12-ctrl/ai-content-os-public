import {readFileSync,writeFileSync,copyFileSync} from "node:fs";
import {spawn} from "node:child_process";
import {join} from "node:path";
import assert from "node:assert/strict";
const path=process.env.STUDIO_SCALE_REPORT||"docs/evidence/content-reuse-measurements.json",report=JSON.parse(readFileSync(path,"utf8"));
const history=process.argv.includes("--history");
const port=39178,base="http://127.0.0.1:"+port;
const pollProbe=join(report.folder,"poll-probe.sqlite");copyFileSync(join(report.folder,"data-production-demo-backup.sqlite"),pollProbe);
for(const row of [...report.scale,{count:0}]){
  const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",String(port)],{windowsHide:true,env:{...process.env,STUDIO_NEXT_DIST_DIR:process.env.STUDIO_NEXT_DIST_DIR||".next/reuse-acceptance",STUDIO_DB:row.count?join(report.folder,row.count+".sqlite"):pollProbe,STUDIO_LIBRARY_DB:join(report.folder,"library.sqlite")}});
  const ended=new Promise(resolve=>server.once("exit",resolve));
  try{
    let ready=false;
    for(let i=0;i<150&&!ready;i++){
      if(server.exitCode!==null)throw Error("服务已退出");
      try{ready=(await fetch(base+"/api/content?topic=")).ok;}catch{}
      if(!ready)await new Promise(r=>setTimeout(r,100));
    }
    assert.ok(ready);
    if(!row.count){
      report.poll={};
      for(const route of ["/api/production","/api/production?view=configuration"]){
        const res=await fetch(base+route);assert.equal(res.status,200);const bytes=await res.arrayBuffer(),data=JSON.parse(Buffer.from(bytes).toString());
        report.poll[route]={bytes:bytes.byteLength,batches:data.batches.length,queue:data.queue.length};
      }
      continue;
    }
    row.http={};
    const routes=["/articles","/articles?q="+encodeURIComponent("折叠，竖放"),"/","/api/work-overview"];
    if(history)for(const q of ["原稿","不存在的稿件"])routes.push("/articles?"+new URLSearchParams({history:"1",q}));
    for(const route of routes){
      const times=[];let bytes;
      for(let i=0;i<17;i++){
        const start=performance.now(),res=await fetch(base+route);
        assert.equal(res.status,200);
        const body=await res.arrayBuffer();bytes=body.byteLength;
        if(i>=2)times.push(performance.now()-start);
        if(i===0&&route.includes("history=1")){
          const term=new URL(route,base).searchParams.get("q");
          assert.ok(Buffer.from(body).toString().includes(term==="原稿"?"查看命中的旧版 v":"没有匹配的稿件。"));
        }
      }
      row.http[decodeURIComponent(route)]={p95ms:+times.sort((a,b)=>a-b)[14].toFixed(1),bytes};
    }
    console.log(row.count,row.http);
  }finally{server.kill();await ended;}
}
writeFileSync(path,JSON.stringify(report,null,2));
