import {it,expect} from "vitest";
import {professionalOutput,independentInstruction} from "../src/studio/professional-review";
it("删除或保留动作不要求无意义替换文本，替换动作仍由执行器验证内容",()=>{
 const assessment={label:"普通",disputed:false,dimensions:{"内容策略":"充分","表达质量":"可改","内容结构":"完整","基础规范":"符合"},issues:[],claims:[]};
 const parsed=professionalOutput.parse({assessment,actions:[{issueIndex:0,action:"delete",evidenceIds:[],blocking:false}]});
 expect(parsed.actions[0].replacement).toBe("");
 expect(()=>professionalOutput.parse({assessment,actions:[{issueIndex:0,action:"delete",replacement:123,evidenceIds:[],blocking:false}]})).toThrow();
});
it("专业审核协议要求唯一逐字引文，保留重复片段的严格定位",()=>{
 expect(independentInstruction("strategy")).toContain("此时省略 before/after");
 expect(independentInstruction("facts")).toContain("不能省略段落间的换行");
});

it("虚构边界说明和标明估算的口播时长不冒充待核实事实，邻近真实主张仍阻断",async()=>{
 const {factTrigger}=await import("../src/studio/professional-review");
 expect(factTrigger("本文没有真实饮用体验、统计数据或效果验证，也不声称完成实证核验")).toBe(false);
 expect(factTrigger("我把同一场景改写成虚构动作，而不是替换成真实经历：")).toBe(false);
 expect(factTrigger("约1分10秒至1分30秒（按正常口播语速估算，实际时长以最终朗读为准）")).toBe(false);
 expect(factTrigger("不使用真实经历，但报名日期为2027年5月1日")).toBe(true);
 expect(factTrigger("时长估算30秒，转化率提高20%")).toBe(true);
});
