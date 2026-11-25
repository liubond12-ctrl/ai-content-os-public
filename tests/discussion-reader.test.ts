import {expect,it} from "vitest";
import {conflictGroups,exactRevision,opinionDecision,type VersionText} from "../src/studio/discussion-reader";
import type {Panel,Opinion} from "../src/studio/professional-review";
it("共享意见的冲突归入同一争议，独立争议分开",()=>{
 const result=conflictGroups({conflicts:[["a","b"],["x","y"],["c","d"],["b","c"],["a","d"]]});
 expect(result.map(g=>g.slice().sort()).sort()).toEqual([["a","b","c","d"],["x","y"]]);
});
it("逐条归因只认绑定的正式修订，重复句按保存偏移核对",()=>{
 const o={id:"delete",action:"delete",issue:{field:"body",quote:"停。",offset:2}} as Opinion;
 const p={id:"panel",articleVersion:6,selected:[o]} as Panel;
 const v={version:6,title:"窗边",body:"停。停。",origin:"model"} as VersionText;
 const next={...v,version:7,parentVersion:6,body:"停。",revisionReviewId:"panel",origin:"ai-revision"} as VersionText;
 expect(exactRevision(p,v,next)).toBe(true);
 expect(exactRevision(p,v,{...next,body:"已改写全文"})).toBe(false);
 expect(exactRevision(p,v,{...next,origin:"human"})).toBe(false);
 const human={...next,origin:"human",decision:{review:"panel",issue:0,opinionId:"delete",choice:"accept",reason:"去掉第二次重复"}} as VersionText;
 expect(opinionDecision(human,p,o)).toBe(true);expect(opinionDecision(human,p,{...o,id:"retain"})).toBe(false);
});