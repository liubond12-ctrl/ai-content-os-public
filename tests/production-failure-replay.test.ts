import {it,expect} from "vitest";
import type {articleSubject} from "../src/studio/eval";
import fixture from "./fixtures/production-failure-replay.json";
import {factTrigger,applyVerdict,type Panel,type Verdict,professionalOutput,advancePanel} from "../src/studio/professional-review";
for(const id of ["04","05","10"] as const)it(id+" 保存响应回放：否定经历说明不应自动追加关键事实",async()=>{
 const sample=fixture[id],facts=sample.calls.find(c=>c.instruction.includes("你是独立专业审核者")&&c.instruction.includes("具体数字、日期"))!;
 const raw=professionalOutput.parse(facts.output);expect(raw.assessment.claims).toEqual([]);
 const checks=sample.panels.flatMap(p=>p.reviews.flatMap(r=>r.result.facts.checks));
 expect(checks.length).toBeGreaterThan(0);
 for(const c of checks){expect(facts.input.body).toContain(c.quote);expect(factTrigger(c.quote)).toBe(false);}
 const input=facts.input;const subject={task:{input:input.request,context:{compiledContext:input.accountRules}},version:input.articleVersion,title:input.title,body:input.body,request:input.request,sources:input.sources} as unknown as ReturnType<typeof articleSubject>;
 const panel:Panel={id:"offline-replay",articleVersion:input.articleVersion,phase:"independent",roles:["facts"],reviews:[],conflicts:[],discussion:[],selected:[],expressionRules:false};
 await advancePanel("offline-replay",panel,false,false,{subject,provider:{model:"saved-response",json:async()=>facts.output}});expect(panel.reviews[0].result.facts.checks).toEqual([]);
});
it("排除措辞不能遮蔽相邻真实主张",()=>{
 for(const s of ["原创虚构，非真实经历；官方报名费为300元","不指向任何真实经历，但研究表明成功率提高20%","虚构故事。考试报名日期为2027年5月1日。"])expect(factTrigger(s)).toBe(true);
});
it("03 原始Judge回放精确拒绝；共享冲突合并后的合法结构可校验且不自动采用错误改写",()=>{
 const sample=fixture["03"],panel=structuredClone(sample.panels.at(-1)) as unknown as Panel;
 const response=sample.calls.find(c=>c.instruction.startsWith("你是Judge"))!.output as unknown as Verdict;
 expect(()=>applyVerdict(structuredClone(panel),response)).toThrow("未知、重复或不相关");
 const ids=[...new Set(panel.conflicts.flat())];
 const corrected:Verdict={decisions:[{opinionIds:ids,action:"human",selectedIds:[],reason:"重叠建议需要作者选择",evidenceIds:[]}]};
 applyVerdict(panel,corrected);expect(panel.status).toBe("human");expect(panel.reason).toContain("主观");
 expect(fixture["03"].panels.at(-1)?.phase).toBe("judge");
});
it("09 原始输出为非关键文本观察；保留人工核对，不假造外部来源",()=>{
 const checks=fixture["09"].panels.flatMap(p=>p.reviews.flatMap(r=>r.result.facts.checks));
 expect(checks).toHaveLength(1);expect(checks[0].critical).toBe(false);expect(checks[0].sourceId).toBeNull();expect(checks[0].quote).toContain("B里没有出现");
});
