import {expect,it} from "vitest";
import {advancePanel,type Panel} from "../src/studio/professional-review";
import {factTrigger,localFactQuotes} from "../src/studio/fact-claims";
import type {articleSubject} from "../src/studio/eval";

const constraint="缺少真实经历与核实信息的地方，不作补足";
const experience="我去年参加了这场活动";
const date="活动开幕日是2025年5月12日";

it("仅排除具体写作约束，保留同句、同段和带虚构标签的具体主张",()=>{
  expect(factTrigger(constraint)).toBe(false);
  expect(factTrigger(constraint.replace("不作", "本文不作"))).toBe(false);
  expect(factTrigger("留白并不等于省略必要的信息；如果涉及真实经历或核实数据，仍应保留缺口")).toBe(false);
  expect(factTrigger(constraint,true)).toBe(true);
  for(const body of [`${constraint}，${experience}。`,`${experience}；${constraint}。`,`${constraint}。${date}。`,`虚构练习：${constraint}，${date}。`]){
    expect(factTrigger(body)).toBe(true);
    expect(localFactQuotes(body)).toEqual([{
      quote:body.includes(experience)?experience:date,
      offset:body.indexOf(body.includes(experience)?experience:date),
    }]);
  }
  expect(factTrigger("我去年没有参加活动，开幕时间是2025年5月12日")).toBe(true);
  expect(factTrigger("我去年没有参加这场活动")).toBe(true);
});

async function panelFor(body:string,role:"strategy"|"facts",modelQuote?:string){
  const subject={task:{input:{},context:{}},version:6,title:"练习",body,request:{},sources:[]} as unknown as ReturnType<typeof articleSubject>;
  const panel:Panel={id:"test",articleVersion:6,phase:"independent",roles:[role],reviews:[],conflicts:[],discussion:[],selected:[],expressionRules:false};
  const provider={model:"fixture",json:async()=>({assessment:{label:"普通",disputed:false,
    dimensions:{内容策略:"符合",表达质量:"清楚",内容结构:"完整",基础规范:"符合"},issues:[],
    claims:modelQuote?[{field:"body",quote:modelQuote,offset:body.indexOf(modelQuote),critical:true,sourceId:null}]:[]},actions:[]})};
  return advancePanel("test",panel,false,false,{subject,provider});
}

it("模型把完整约束或约束内片段标成关键主张时，定位后排除误判",async()=>{
  for(const quote of [`${constraint}。`,"真实经历"]){
    const panel=await panelFor(`${constraint}。`,"strategy",quote);
    expect(panel.roles).toEqual(["strategy"]);
    expect(panel.status).toBe("pass");
    expect(panel.reviews[0].result.facts.checks).toEqual([]);
  }
});

it("模型漏报真实经历时本地补检；模型引用整句时仍保留事实检查",async()=>{
  const body=`${constraint}；${experience}。`;
  const local=await panelFor(body,"facts","真实经历");
  expect(local.status).toBe("human");
  expect(local.reviews[0].result.facts.checks).toMatchObject([{quote:experience,critical:true,sourceId:null,status:"待核验"}]);
  const model=await panelFor(body,"facts",body);
  expect(model.status).toBe("human");
  expect(model.reviews[0].result.facts.checks).toMatchObject([{quote:body,critical:true,status:"待核验"}]);
});
