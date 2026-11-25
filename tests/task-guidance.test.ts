import {expect,it} from "vitest";
import {quoteCandidates,taskGuidance} from "../src/studio/task-guidance";
it("explains ambiguous quotes without changing verdict or offering automatic retry",()=>{
 const hint=taskGuidance("Error: AMBIGUOUS_QUOTE · issues.1.quote",true)!;
 expect(hint.title).toBe("审核原句位置待确认");expect(hint.detail).toContain("已保留");expect(hint.next).toContain("不代表审核已通过");
 expect(taskGuidance("请求结果未知",true)?.next).toContain("核对");
 expect(taskGuidance("资料不足",false)?.detail).toContain("尚未获得");
 expect(taskGuidance("草稿已修改",true)?.next).toContain("合并");
 expect(taskGuidance("专业审核通过",true)).toBeNull();
});
it("locates duplicate quotes with exact UTF16 offsets and respects supplied context",()=>{
 const article={title:"标题",body:"📝【配图计划】\n首图\n\n## 配图计划\n尾图"};
 const item={field:"body" as const,quote:"配图计划"};
 const options=quoteCandidates(article,item);expect(options).toHaveLength(2);
 for(const o of options)expect(article.body.slice(o.offset,o.offset+item.quote.length)).toBe(item.quote);
 expect(quoteCandidates(article,{...item,before:"## "})).toEqual([options[1]]);
 expect(quoteCandidates(article,{...item,quote:"不存在"})).toEqual([]);
 expect(quoteCandidates(article,{...item,quote:""})).toEqual([]);
});
