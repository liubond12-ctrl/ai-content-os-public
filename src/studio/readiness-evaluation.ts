import cases from "../../evaluation/readiness-cases.json";
import {finalize} from "./eval";
import {localFactQuotes} from "./fact-claims";
import {assembleProduction} from "../context/assembler";
import {channelRadar} from "./channel-delivery";
import type {ChannelContent} from "../types/channel-derivation";
import type {Task} from "./tasks";

export function readinessEvaluation(){
  const score=(count:number,total:number)=>({count,total,rate:total?count/total:null});
  const facts=cases.facts.map(row=>{
    const task:Task={id:"benchmark:"+row.id,revision:1,stage:"done",records:[],input:{persona:"general",topic:"隔离样本",mode:"keyword",audience:"",reference:""}};
    const source={task,version:1,title:"",body:row.body,sources:[],request:{}};
    const claims=row.singleDetected?[{field:"body" as const,quote:row.body,offset:0,sourceId:null,critical:true}]:[];
    const model={label:"普通",disputed:false,dimensions:{内容策略:"模拟",表达质量:"模拟",内容结构:"模拟",基础规范:"模拟"},claims,issues:[]};
    const guarded=finalize(source,model,localFactQuotes(row.body).map(claim=>({...claim,field:"body" as const,critical:true,sourceId:null})));
    return {...row,single:row.singleDetected,full:guarded.status==="blocked"||guarded.status==="human_review"};
  });
  const personas=cases.personas.map(row=>{
    const full=assembleProduction("",{brand:"default",account:row.id,accountName:row.id,accountDescription:"",platform:"小红书",kind:"图文",
      outline:"",requirements:"",rules:[{id:row.id,version:1,name:"账号规范",body:row.rule,hash:"",hard:true,reason:"账号"}],
      standards:[],attachments:[],imagesRequired:false,mode:"离线示例"}).compiledContext;
    const single=cases.personas[0].rule;
    return {...row,single:single.includes(row.rule),full:full.includes(row.rule)&&cases.personas.filter(other=>other.id!==row.id).every(other=>!full.includes(other.rule))};
  });
  const channels=cases.channels.map(row=>{
    const shared={keywords:[],cta:"",title:"样稿"};
    const content:ChannelContent=row.variant==="xiaohongshu"?{...shared,variant:"xiaohongshu",titles:[row.text],body:row.text,tags:[],comments:[]}:
      row.variant==="douyin-script"?{...shared,variant:"douyin-script",hooks:[],script:row.text}:{...shared,variant:"wechat",blocks:[{kind:"paragraph",text:row.text}]};
    return {...row,single:false,full:channelRadar(content).matches.length>0};
  });
  const realFacts=facts.filter(row=>row.unsupported),risky=channels.filter(row=>row.risky);
  const metrics=[
    {label:"事实幻觉拦截",formula:"被标为阻断或待人工核验的不实主张 ÷ 不实样本",single:score(realFacts.filter(row=>row.single).length,realFacts.length),full:score(realFacts.filter(row=>row.full).length,realFacts.length)},
    {label:"多账号人设一致性",formula:"只含所属账号规范的装配 ÷ 账号样本",single:score(personas.filter(row=>row.single).length,personas.length),full:score(personas.filter(row=>row.full).length,personas.length)},
    {label:"三端违禁词命中",formula:"被标注的风险稿 ÷ 已知风险稿",single:score(risky.filter(row=>row.single).length,risky.length),full:score(risky.filter(row=>row.full).length,risky.length)},
    {label:"风险词未提示残留",formula:"未被提示的风险稿 ÷ 已知风险稿",single:score(risky.filter(row=>!row.single).length,risky.length),full:score(risky.filter(row=>!row.full).length,risky.length)},
  ];
  return {metrics,facts,personas,channels,basis:"合成样本离线回放。单 Agent 列使用冻结的模拟输出与固定画像基准；全链路列实际执行事实守卫、动态装配和渠道雷达。发布后风险残留未测。"};
}
