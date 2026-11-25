import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {readFeed} from "../src/studio/aihot";

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("离线热点只返回本机样例，真实路由保持原有数据分支",async()=>{
  vi.stubEnv("STUDIO_DEMO_INSTANCE","1");vi.stubEnv("STUDIO_WORKER_URL","http://127.0.0.1:3799");
  const request=vi.fn<typeof fetch>();vi.stubGlobal("fetch",request);
  const fixture=await readFeed("latest");
  expect(fixture.items[0].canonical).toBe("http://127.0.0.1:3799/hot?fixture=paper");
  expect(request).not.toHaveBeenCalled();
  vi.stubEnv("STUDIO_DEMO_INSTANCE","0");request.mockResolvedValue(Response.json({items:[]}));
  expect((await readFeed("latest")).items).toEqual([]);
  expect(request).toHaveBeenCalledTimes(1);
});
it("生产启动器双向隔离 SQLite，并拒绝个人 data 的子目录",()=>{
  const dir=mkdtempSync(join(tmpdir(),"marked-workbench-demo-"));
  const seed=spawnSync(process.execPath,["-e","require('node:fs').writeFileSync(require('node:path').join(process.argv[1],'.studio-demo'),'demo')",dir],{encoding:"utf8"});
  expect(seed.status).toBe(0);
  const live=spawnSync(process.execPath,["scripts/start-production.mjs"],{env:{...process.env,STUDIO_DATA_DIR:dir},encoding:"utf8",timeout:3000});
  expect(live.status).toBe(1);
  expect(live.stderr).toContain("真实模式不能使用离线演练数据库");
  const liveDir=mkdtempSync(join(tmpdir(),"unmarked-workbench-production-"));
  const db=new DatabaseSync(join(liveDir,"studio.sqlite"));
  db.exec("CREATE TABLE production_batches(mode TEXT); INSERT INTO production_batches VALUES('本机模型')");
  db.close();
  const demo=spawnSync(process.execPath,["scripts/start-production.mjs","--demo"],
    {env:{...process.env,STUDIO_DATA_DIR:liveDir},encoding:"utf8",timeout:3000});
  expect(demo.status).toBe(1);
  expect(demo.stderr).toContain("离线演练需使用新的数据目录");
  const risky=spawnSync(process.execPath,["scripts/start-production.mjs","--demo"],{env:{...process.env,STUDIO_DATA_DIR:"data/audit-test-unused"},encoding:"utf8",timeout:3000});
  expect(risky.status).toBe(1);
  expect(risky.stderr).toContain("个人 data 目录及其子目录");
});
it("离线 Node 出站守卫拒绝普通网络 API，只记录类别",()=>{
  const dir=mkdtempSync(join(tmpdir(),"readiness-net-test-")),log=join(dir,"network.jsonl");
  const probe=`
    const assert=require('node:assert/strict');
    (async()=>{
      await assert.rejects(fetch('https://example.invalid/'),{code:'STUDIO_DEMO_EGRESS_BLOCKED'});
      assert.throws(()=>require('node:https').get('https://example.invalid/'),{code:'STUDIO_DEMO_EGRESS_BLOCKED'});
      assert.throws(()=>require('node:dns').lookup('example.invalid',()=>{}),{code:'STUDIO_DEMO_EGRESS_BLOCKED'});
      assert.throws(()=>require('node:net').connect(443,'example.invalid'),{code:'STUDIO_DEMO_EGRESS_BLOCKED'});
    })().catch(e=>{console.error(e.name);process.exitCode=1});
  `;
  const child=spawnSync(process.execPath,["--require","./scripts/demo-network-guard.cjs","-e",probe],
    {env:{...process.env,STUDIO_DEMO_INSTANCE:"1",STUDIO_DEMO_NET_LOG:log},encoding:"utf8",timeout:4500});
  expect(child.status,child.stderr).toBe(0);
  const events=readFileSync(log,"utf8").trim().split("\n").map(line=>JSON.parse(line));
  expect(events.filter(row=>row.event==="blocked").map(row=>row.kind)).toEqual(["fetch","http","dns","socket"]);
  expect(events.every(row=>Object.keys(row).sort().join()==="event,kind,pid")).toBe(true);
});
