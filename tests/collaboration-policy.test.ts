import {describe,it,expect} from "vitest";
import {decideReview,mayCommitResult,type ReviewInput} from "../src/studio/collaboration-policy";
const pass:ReviewInput={articleVersion:7,status:"pass",result:{disputed:false,issues:[],facts:{checks:[]}}};
describe("collaboration decisions",()=>{
  it("requires human acceptance, never publication",()=>expect(decideReview(pass,7,0).state).toBe("awaiting_acceptance"));
  it("rejects a review of another version",()=>expect(decideReview(pass,8,0).state).toBe("failed"));
  it("routes facts and subjective choices to humans",()=>{
    expect(decideReview({...pass,result:{...pass.result!,disputed:true}},7,0).state).toBe("human");
    expect(decideReview({...pass,result:{...pass.result!,facts:{checks:[{status:"待核验"}]}}},7,0).state).toBe("human");
  });
  it("only revises explicit expression or structure issues, at most twice",()=>{
    const r={...pass,status:"revise",result:{...pass.result!,issues:[{type:"表达",reason:"重复"}]}};
    expect(decideReview(r,7,0).state).toBe("revision");
    expect(decideReview(r,7,1).state).toBe("revision");
    expect(decideReview(r,7,2).state).toBe("human");
    expect(decideReview({...r,result:{...r.result,issues:[{type:"安全",reason:"需核实"}]}},7,0).state).toBe("human");
  });
  it("separates failures and unknown requests from content judgments",()=>{
    expect(decideReview({...pass,status:"failed"},7,0).state).toBe("failed");
    expect(decideReview({...pass,status:"running"},7,0).state).toBe("unknown");
  });
  it("fences stopped, stale and human edited results",()=>{
    const f={revision:1,articleVersion:7,draftRevision:2,stopped:false};
    expect(mayCommitResult(f,f)).toBe(true);
    for(const delta of [{stopped:true},{revision:2},{articleVersion:8},{draftRevision:3}])
      expect(mayCommitResult(f,{...f,...delta})).toBe(false);
  });
});
