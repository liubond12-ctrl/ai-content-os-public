import {it,expect} from "vitest";
import records from "./research-failures.json";
import {assess,writerBrief} from "../src/studio/writability";
import {brief} from "../src/studio/tasks";
import type {Hit} from "../src/rag/search";
for(const record of records){
  it(`真实失败回放 ${record.id}：显式限定交付后可写，原始记录不改写`,()=>{
    const before=JSON.stringify(record),d=record.decisions.at(-1)!;
    const input=brief.parse({...record.input,writingScope:"text-analysis"});
    const evidence=record.evidence as Hit[];
    const plan=assess(input,evidence,record.decisions.some(x=>x.needsFacts),d.questions,d.coreGaps,d.limits);
    expect(plan.status).toBe("ready_with_limits");
    expect(plan.handoff.needsFacts).toBe(d.needsFacts);
    expect(plan.handoff.optionalQuestions).toEqual([...d.coreGaps,...d.questions]);
    expect(plan.handoff.writingPlan?.methodIds).toEqual(evidence.map(h=>h.id));
    expect(writerBrief({...plan,version:6,model:"replay",evidence,questions:[]}).writingPlan?.steps).toHaveLength(3);
    expect(JSON.stringify(record)).toBe(before);
  });
}
it.each(["公布考级报名日期","证明某种文风必然导致销量上涨","证实某产品效果的因果关系"])("限定范围不能覆盖明确事实要求：%s",topic=>{
  const input=brief.parse({...records[1].input,topic,writingScope:"text-analysis"});
  expect(assess(input,records[1].evidence as Hit[],false,[],[],[]).status).toBe("blocked");
});
it("可选事实不升级成任务必需，方法始终不是已核实事实",()=>{
  const r=records[1],d=r.decisions.at(-1)!;
  expect(assess(brief.parse(r.input),r.evidence as Hit[],true,d.questions,d.coreGaps,d.limits).status).toBe("blocked");
  const plan=assess(brief.parse({...r.input,topic:"评论叙事节奏",writingScope:"text-analysis"}),r.evidence as Hit[],true,["是否有调查支持"],["读者体验研究"],["不能声称普遍有效"]);
  expect(plan.status).toBe("ready_with_limits");expect(plan.handoff.forbidden.length).toBeGreaterThan(0);
  expect(r.evidence.every(h=>!h.verified && h.kind==="expression-rule")).toBe(true);
});
