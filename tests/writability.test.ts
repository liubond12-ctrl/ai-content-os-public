import {expect,it,vi} from "vitest";
import {assess,draftLabel} from "../src/studio/writability";
import {safeInput,safeKnowledge} from "../src/studio/safe-demo";
import {valid,write,type Research} from "../src/studio/agents";
import type {Task} from "../src/studio/tasks";

const evidence=safeKnowledge().chunks.map((h,i)=>({...h,score:1,finalRank:i+1}));
const input=safeInput("followup");
const limitation="一次观察未说明是否算复试通过或是否彻底解决。";
const general={persona:"general",topic:"为什么 AI 写出来的内容有 AI 味",format:"图文文章",audience:"创作者",reference:"",mode:"keyword"} as const;
const method={...evidence[0],id:"general/reference/test/v1",kind:"expression-rule" as const,text:"以虚构例子比较抽象评价和具体动作。",verified:false};
it.each([
  ["为什么 AI 写出来的内容有 AI 味",false,[],["不能推断模型机制或普遍性"],"ready_with_limits"],
  ["写一篇虚构的雨夜故事",false,[],[],"ready"],
  ["公布考级报名日期",false,[],[],"blocked"],
  ["证明使用某模型必然导致表达空洞",false,[],[],"blocked"],
  ["证实模板表达与阅读疲劳的因果关系",false,[],[],"blocked"],
  ["讨论写作感受，不提供统计结论",false,[],["统计比例未核实，不作为结论"],"ready_with_limits"],
  ["讨论写作感受",false,[],["没有可用的比例数据，不声称普遍有效"],"ready_with_limits"],
  ["讨论写作感受",true,[],["没有可靠数据"],"blocked"],
  ["讨论写作感受",false,["原要求的必要事实缺失"],[],"blocked"]
] as const)("通用边界：%s",(topic,needs,gaps,limits,status)=>{
  const result=assess({...general,topic},[method],needs,[],[...gaps],[...limits]);
  expect(result.status).toBe(status);expect(result.handoff.needsFacts).toBe(needs);
});
it("有效事实来源可支持事实写作；无资料和未知问题不因空 coreGaps 放行",()=>{
  const fact={...method,kind:"fact-reference" as const,verified:true,temporal:{...method.temporal,status:"current-verified" as const}};
  expect(assess({...general,topic:"介绍报名日期"},[fact],true,[],[],[]).status).toBe("ready");
  expect(assess(general,[],false,[],[],["仅观点"]).status).toBe("blocked");
  expect(assess(general,[method],false,["无法满足核心要求"],[],[]).status).toBe("blocked");
});
it("通用限定写作使用文章契约并保留人工审核标记，不能冒用纸翼编排",async()=>{
  const limits=["不能证明普遍性"];
  const plan=assess(general,[method],false,[],[],limits);
  const r:Research={...plan,version:4,model:"mock",evidence:[method],questions:limits};
  const t={input:general,revision:5,research:r,context:{compiledContext:"通用规则"},decisions:[{needsFacts:false,questions:[],coreGaps:[],limits}]} as unknown as Task;
  const provider={model:"mock",json:vi.fn().mockResolvedValue({title:"表达练习",body:"举个虚构例子：他把空话换成了一个动作。",citations:[method.id]})};
  const a=await write(t,provider);expect(a.reviewLabel).toBe(draftLabel);expect(a.researchVersion).toBe(4);
  expect(a.body).not.toContain("试飞");expect(provider.json.mock.calls[0][0]).toContain("不是事实依据");
});
it("已覆盖的观察任务保留未逐字匹配的疑问；缺证和显式核心缺口仍阻塞",()=>{
  const fixed=safeInput("limited-writing");
  const questions=["困难发生于纸翼左偏，但具体原因与改动部件未在手记中记录，属缺失事实。","没有多次复试记录，无法判断结果是否稳定，属缺失事实。"];
  const material=evidence.filter(h=>["safe-demo:workshop","safe-demo:notebook"].includes(h.id));
  const grade=(hits:typeof material,gaps:string[]=[])=>assess(fixed,hits,false,questions,gaps,["仅可描述一次观察"]);
  const result=grade(material);
  expect(result.status).toBe("ready_with_limits");
  expect(result.handoff.coreGaps).toEqual([]);
  expect(result.handoff.limits).toEqual(expect.arrayContaining(questions));
  expect(grade(material.slice(0,1)).status).toBe("blocked");
  expect(grade(material,["原任务的必要事实尚未满足"]).status).toBe("blocked");
});
it("B：单次观察可写；补查缺少关键记录或仍需要现实事实时保守阻塞",()=>{
  expect(assess(input,evidence,false,[limitation],[],[]).status).toBe("ready_with_limits");
  expect(assess(input,evidence.filter(h=>h.id!=="safe-demo:notebook"),false,[],[],[limitation]).status).toBe("blocked");
  expect(assess(input,evidence,true,[],[],[limitation]).status).toBe("blocked");
});
it("C：即使模型否认需要事实、没有列出问题，表达资料不能支持官方日期",()=>{
  const result=assess(safeInput("missing"),evidence,false,[],[],[]);
  expect(result.status).toBe("blocked");
  expect(result.handoff.coreGaps).toContain("缺少已核实且当前有效的事实依据");
});
it("D：有完整观察记录仍不能放行要求证明彻底解决的原任务",()=>{
  const result=assess({...input,topic:"请证明纸翼左偏问题已经彻底解决"},evidence,false,[],[],[limitation]);
  expect(result.status).toBe("blocked");
  expect(result.handoff.coreGaps).toContain("观察性证据不能满足原任务要求的证明");
});
it("限定草稿拒绝模型添加成功断言，且版本检查要求标签与依赖均有效",async()=>{
  const plan=assess(input,evidence,false,[],[],[]);
  const r:Research={...plan,version:4,model:"mock",evidence,questions:[]};
  const t={input,revision:5,research:r} as Task;
  const provider={model:"mock",json:vi.fn().mockResolvedValue({segments:[...plan.handoff.supported,{sourceId:"safe-demo:notebook",quote:"复试彻底成功。"}]})};
  await expect(write(t,provider)).rejects.toThrow("越出");
  const a={researchVersion:4,model:"mock",version:6,title:"测试",body:"测试",citations:[]};
  expect(valid(a,r)).toBe(false);
  expect(valid({...a,reviewLabel:draftLabel},r)).toBe(true);
  expect(valid({...a,reviewLabel:draftLabel},{...r,version:5})).toBe(false);
});
