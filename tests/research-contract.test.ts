import {it,expect} from "vitest";
import {parseDecision,decisionSchema,CONTRACT_VERSION} from "../src/studio/research-contract";
import {researchPrompt} from "../src/studio/agents";
import {GET} from "../src/app/api/version/route";
const output={action:"finish",query:"",mode:"keyword",needsFacts:true,questions:[],coreGaps:["缺少必要事实"],limits:[],optionalQuestions:[],sources:[]};
it("单一契约用于 Prompt 和校验，真实布尔判断不被修改",()=>{
  expect(researchPrompt(true)).toContain(JSON.stringify(decisionSchema));
  expect(parseDecision(output).needsFacts).toBe(true);
  expect(parseDecision({...output,needsFacts:false}).needsFacts).toBe(false);
});
it("无法无损修复的数组拒绝，诊断只留类型和哈希，不留内容",()=>{
  expect(()=>parseDecision({...output,needsFacts:["private-content"]})).toThrow("received=array");
  try{parseDecision({...output,needsFacts:["private-content"]});}catch(e){expect(String(e)).not.toContain("private-content");expect(String(e)).toContain("sha256=");}
  expect(()=>parseDecision({...output,needsFacts:[false]})).toThrow();
});
it("部署识别接口返回契约版本且禁止缓存，不读取审批或密钥",async()=>{
  const response=GET();expect(response.headers.get("cache-control")).toBe("no-store");
  const data=await response.json();expect(Object.keys(data).sort()).toEqual(["build","researchContract"]);expect(data.researchContract).toBe(CONTRACT_VERSION);
});
