import {it,expect,vi,beforeEach,afterEach} from "vitest";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {POST as taskPost} from "../src/app/api/tasks/route";
import {POST as importRef,GET as browse,DELETE as remove} from "../src/app/api/references/route";
import {POST as saveEval,GET as readEval} from "../src/app/api/eval-cases/route";
import {findMethods,references,genericProfile} from "../src/studio/library";
import * as rag from "../src/rag/search";
import * as context from "../src/context/assembler";
import type {Task} from "../src/studio/tasks";
const req=(body:unknown)=>new Request("http://localhost/test",{method:"POST",body:JSON.stringify(body)});
const submit=async(body:unknown)=>(await taskPost(req(body))).json() as Promise<Task>;
beforeEach(()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"content-os-"));
  vi.stubEnv("STUDIO_DB",path.join(dir,"tasks.db"));vi.stubEnv("STUDIO_LIBRARY_DB",path.join(dir,"library.db"));
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("禁止联网");}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
it("无账号跨行业任务按技法检索，只装配方法，云端发送被拒绝",async()=>{
  const legacy=vi.spyOn(rag,"knowledge"),assemble=vi.spyOn(context,"assembleContext");
  vi.stubEnv("STUDIO_MODEL_URL","https://api.deepseek.com/chat/completions");vi.stubEnv("STUDIO_MODEL","test");
  let t=await submit({topic:"为天文馆讲解月相",format:"口播稿",style:"开头钩子",goal:"引发好奇",mode:"hybrid",generate:true});
  expect(t.input.persona).toBe("general");
  for(let i=0;i<2;i++)t=await submit({id:t.id,revision:t.revision});
  expect(t.context?.compiledContext).toContain("口播稿");
  expect(t.result?.retrieval.hits[0].id).toContain("kitchen-hook");
  expect(t.result?.retrieval.hits.every(h=>h.id.startsWith("general/reference/")&&!h.verified)).toBe(true);
  expect(t.result?.assembly.compiledContext).not.toContain(references()[1].content);
  expect(legacy).not.toHaveBeenCalled();expect(assemble).not.toHaveBeenCalled();
  t=await submit({id:t.id,revision:t.revision});
  expect(t.stage).toBe("blocked");expect(fetch).not.toHaveBeenCalled();
  expect(genericProfile.bindings).toEqual([]);
});
it("参考导入版本与人工 Eval 独立，Eval 内容绝不进入检索",async()=>{
  const item={...references()[0],id:"example",method:"用矛盾开场",tags:["矛盾"]};
  expect((await importRef(req(item))).status).toBe(201);
  expect((await importRef(req(item))).ok).toBe(false);
  expect((await (await browse()).json()).some((c:{id:string})=>c.id==="example")).toBe(true);
  const evaluation={id:"eval-one",version:1,content:"盲评专用样本",referenceId:"example",label:"普通",reviewer:"fixture reviewer",
    dimensions:["结构"],rationale:"结尾没有回应开头",locations:["结尾"],positiveExample:"回到原问题",negativeExample:"重复口号",
    scenario:"口播练习",tags:["结构"],rights:"原创",source:"离线测试",allowExternal:false,createdAt:item.createdAt};
  expect((await saveEval(req({item:evaluation}))).status).toBe(400);
  expect((await saveEval(req({item:evaluation,humanReviewed:true}))).status).toBe(201);
  expect(await readEval().json()).toEqual([evaluation]);
  for(const mode of ["keyword","semantic","hybrid"] as const){
    const r=await findMethods({topic:"开场",audience:"",format:"口播稿"},"矛盾",mode);
    expect(r.hits.every(h=>h.id.startsWith("general/reference/"))).toBe(true);
    expect(JSON.stringify(r)).not.toContain("盲评专用样本");
  }
});
it("案例编辑、并发旧版本防护、筛选和移除同时作用于 RAG",async()=>{
  const base=references()[0];
  expect(base.synthetic).toBe(true);
  const edit={...base,version:2,tags:["转折"],facts:"样例中的地点不可当作事实迁移"};
  expect((await importRef(req(edit))).status).toBe(201);
  expect((await importRef(req(edit))).ok).toBe(false);
  const results=await (await browse(new Request("http://localhost/api/references?"+new URLSearchParams({tag:"转折",format:edit.format,goal:edit.goal,q:"转折",mode:"hybrid"})))).json();
  expect(results.map((c:{id:string})=>c.id)).toEqual([edit.id]);
  const search=()=>findMethods({topic:"转折",audience:""},"转折","keyword");
  expect(JSON.stringify(await search())).not.toContain(edit.facts);
  expect((await remove(new Request("http://localhost/api/references?id="+base.id+"&version=1"))).status).toBe(409);
  expect((await remove(new Request("http://localhost/api/references?id="+base.id+"&version=2"))).ok).toBe(true);
  expect((await search()).hits.some(h=>h.id.includes(base.id))).toBe(false);
});
it("独立集答案仅人工持钥可读，盲测接口无标签，统计只计最新版本",async()=>{
  vi.stubEnv("STUDIO_EVAL_REVIEW_KEY","offline-test");
  const url="http://localhost/api/eval-cases";
  const headers={"x-review-key":"offline-test"};
  const entry={id:"hold-one",content:"程序只赞美，没有描述过程。",source:"原创测试",rights:"原创",synthetic:true,version:1,
    label:"不合格",dimensions:["内容结构"],rationale:"缺乏依据",locations:["开头"],issues:[{offset:0,quote:"程序",severe:true}],
    positiveExample:"展示过程",negativeExample:"空泛评价",scenario:"教程",tags:["论证"],reviewer:"测试标注人",createdAt:"2026-11-03T00:00:00Z",allowExternal:false,
    split:"holdout",format:"图文文章",goal:"解释",aiSuggestion:"未经确认的辅助意见"};
  const send=(item:unknown,humanReviewed:boolean)=>saveEval(new Request(url,{method:"POST",headers,body:JSON.stringify({humanReviewed,item})}));
  expect((await send(entry,false)).status).toBe(400);
  expect((await send({...entry,issues:[{offset:1,quote:"程序",severe:true}]},true)).status).toBe(400);
  expect((await saveEval(req({humanReviewed:true,item:entry}))).status).toBe(403);
  const pending={...entry,id:"unassigned",content:"程序先展示一个动作。",split:"pool"};
  expect((await send(pending,true)).status).toBe(201);
  expect(await readEval(new Request(url+"?view=inputs")).json()).toEqual([]);
  expect((await saveEval(req({humanReviewed:true,item:{...pending,version:2,split:"dev"}}))).status).toBe(403);
  expect((await send({...pending,version:2,split:"holdout"},true)).status).toBe(201);
  expect((await send(entry,true)).status).toBe(201);
  expect((await send({...entry,version:2,label:"普通"},true)).status).toBe(201);
  expect((await send({...entry,id:"dev-copy",split:"dev"},true)).ok).toBe(false);
  expect(await readEval().json()).toEqual([]);
  const blind=await readEval(new Request(url+"?view=inputs")).json();
  expect(Object.keys(blind[0]).sort()).toEqual(["id","version","format","goal","criteria","content","split"].sort());
  expect(readEval(new Request(url+"?view=history")).status).toBe(403);
  const history=await readEval(new Request(url+"?view=history",{headers})).json();
  expect(history.filter((c:{id:string})=>c.id===entry.id).map((c:{label:string})=>c.label)).toEqual(["不合格","普通"]);
  const stats=await readEval(new Request(url+"?view=stats",{headers})).json();
  expect(stats[1]).toMatchObject({count:2,labels:{普通:1,不合格:1}});
});
