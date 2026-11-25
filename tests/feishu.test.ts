import {it,expect,vi} from "vitest";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {syncFeishu,feishuMethods,syncStatus} from "../src/studio/feishu";
import {methodIndex} from "../src/studio/library";
import {localProvider} from "../src/studio/provider";
import {create} from "../src/studio/tasks";
import {execFileSync} from "node:child_process";
import {DatabaseSync} from "node:sqlite";
it("幂等同步、用途隔离、失败暂停、全量删除、撤权脱敏",async()=>{
 const file=path.join(mkdtempSync(path.join(tmpdir(),"feishu-")),"library.db");vi.stubEnv("STUDIO_LIBRARY_DB",file);
 const c={app:"demo",table:"tbltest",fields:{title:"T",method:"M",updated:"U"},permissions:{store:true,create:true,evaluate:false,external:false}};
 vi.stubEnv("STUDIO_FEISHU_SCOPE",JSON.stringify(c));
 const row={record_id:"rec1",fields:{T:"虚构练习",M:"用动作表达选择",U:1700000000000}};
 const mock=(items:unknown[],more=false)=>vi.fn(async()=>Response.json({code:0,data:{items,has_more:more}}));
 try{
  await syncFeishu(c,"test",mock([row,row]));await syncFeishu(c,"test",mock([row]));expect(feishuMethods()).toHaveLength(1);expect(feishuMethods()[0].version).toBe(1);
  expect(methodIndex(true).chunks.some(x=>x.path.includes("fs-"))).toBe(false);
  const lastSuccess=syncStatus().success;expect(lastSuccess).toBeTruthy();expect(syncStatus().permissions).toEqual(c.permissions);
  await expect(syncFeishu(c,"test",mock([],true))).rejects.toThrow("下一页");expect(feishuMethods()).toHaveLength(0);
  expect(syncStatus().reason).toContain("缺少下一页");expect(syncStatus().success).toBe(lastSuccess);
  await syncFeishu(c,"test",mock([{...row,fields:{...row.fields,M:"新版方法"}}]));expect(feishuMethods()[0].version).toBe(2);
  await syncFeishu(c,"test",mock([]));expect(feishuMethods()).toHaveLength(0);
  await syncFeishu(c,"test",mock([row]));const deny=mock([]);await syncFeishu({...c,permissions:{...c.permissions,store:false}},"",deny);expect(deny).not.toHaveBeenCalled();
  vi.stubEnv("STUDIO_DB",file+".tasks");vi.stubEnv("STUDIO_MODEL","mock");vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:1/mock");
  const task=create({topic:"写作方法",format:"图文文章",mode:"keyword"});
  const id="general/reference/fs-revoked/v1";const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
  try{await expect(localProvider({task:{...task,tools:[{mode:"keyword",round:1,query:"",elapsedMs:0,hits:[{id} as never]}]}}).json("研究",{})).rejects.toThrow("资料授权");expect(fetchMock).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}
  const sandbox=new DatabaseSync(file+".tasks"),source="a".repeat(64);
  sandbox.prepare("INSERT INTO versions VALUES(?,?,?)").run(task.id,1,JSON.stringify({source:"飞书/"+source+"/rec1"}));
  const maintenance=(args:string[])=>execFileSync(process.execPath,["scripts/purge-source-history.mjs",source,...args],{encoding:"utf8",env:{...process.env,STUDIO_DB:file+".tasks"}});
  const preview=JSON.parse(maintenance([]));expect(preview.affectedTasks).toEqual([task.id]);maintenance([preview.confirmation]);expect(sandbox.prepare("SELECT * FROM versions WHERE id=?").get(task.id)).toBeUndefined();sandbox.close();
  const d=new DatabaseSync(file);try{expect(d.prepare("SELECT payload FROM source_rows").get()?.payload).toBeNull();}finally{d.close();}
 }finally{vi.unstubAllEnvs();}
});
