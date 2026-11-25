// Deterministic local fixture. Never represents real model or business-quality validation.
export function fixtureResponse(instruction,data){
 const input=data.input??data.request;
 const assessment={label:"普通",disputed:false,dimensions:{内容策略:"离线结构检查",表达质量:"明确虚构",内容结构:"按栏目组织",基础规范:"业务标准未配置"},issues:[],claims:[]};
 if(instruction.startsWith("局部精修：写一句"))return {text:"如果是你，会用哪个动作表现她的犹豫？"};
 if(instruction.startsWith("局部精修：按建议"))return {text:"她把纸角压平，指尖沿着折痕缓慢滑过。"};
 if(instruction.startsWith("你是独立")){
  const quote="她停下来。";
  const body=String(data.body),offset=body.lastIndexOf(quote);
  if(input?.topic?.includes("会诊演练")&&body.includes("蓝笔落在了桌上。")){
   const strategy=instruction.includes("回应需求");
   const examples=[
    ["蓝笔落在了桌上。","她把蓝笔横放在校样旁。","蓝笔轻轻碰了碰桌面。","动作要点不够明确","声音和节奏可以更鲜明"],
    ["她看了很久。","她把同一行从头读了三遍。","她盯着那行字，迟迟没有翻页。","时长缺少具体动作","保持停顿而减少抽象判断"],
    ...(strategy&&body.includes("她理好了纸张。")?[["她理好了纸张。","她压平了纸角。","","整理过程过于概括",""]]:[]),
   ].filter(([quote])=>body.includes(quote));
   assessment.label="不合格";
   assessment.issues=examples.map(([quote,left,right,a,b])=>({field:"body",quote,offset:body.indexOf(quote),type:"表达",severity:"明显",reason:strategy?a:b,suggestion:strategy?left:right}));
   return {assessment,actions:examples.map(([,left,right],issueIndex)=>({issueIndex,action:"replace",replacement:strategy?left:right,evidenceIds:[],blocking:false}))};
  }
  if(input?.topic?.includes("分歧演练")&&body.indexOf(quote)!==offset&&offset>=0){
   const action=instruction.includes("回应需求")?"retain":"delete";
   assessment.issues=[{field:"body",quote,offset,before:body.slice(Math.max(0,offset-12),offset),type:"表达",severity:"明显",reason:action==="retain"?"保留复沓节奏":"删除无信息重复",suggestion:action==="retain"?"保留节奏":"删除重复句"}];
   return {assessment,actions:[{issueIndex:0,action,replacement:"",evidenceIds:[],blocking:true}]};
  }
  return {assessment,actions:[]};
 }
 if(instruction.includes("审核者。只回应"))return {responses:data.respondTo.map((opinionId,index)=>({opinionId,position:input?.topic?.includes("会诊演练")&&index===1?"withdraw":"maintain",reason:input?.topic?.includes("会诊演练")?(index===1?"撤回原建议，留给作者按这段叙述的节奏取舍。":"维持意见，具体理由已写在本角色的修改方案里。"):"依据当前版本与需求维持意见",evidenceIds:[]}))};
 if(instruction.startsWith("你是Judge")&&input?.topic?.includes("会诊演练"))return {decisions:data.conflicts.map(opinionIds=>({opinionIds,action:"human",selectedIds:[],reason:"两种改法突出不同观察点，由作者按文章重心取舍。",evidenceIds:[]}))};
 if(instruction.startsWith("你是Judge"))return {decisions:[{opinionIds:[...new Set(data.conflicts.flat())],action:"accept",selectedIds:data.opinions.filter(o=>o.action==="delete").map(o=>o.id),reason:"删除无信息重复，保留其余栏目",evidenceIds:[]}]};
 if(data.researchInput){
  let body=data.article.body;
  for(const issue of [...data.review.issues].sort((a,b)=>b.offset-a.offset))body=body.slice(0,issue.offset)+(issue.suggestion==="删除指定片段"?"":issue.suggestion)+body.slice(issue.offset+issue.quote.length);
  const sections=body.split(/^## /m).slice(1).map(s=>({name:s.slice(0,s.indexOf("\n")).trim(),text:s.slice(s.indexOf("\n")+1).trim()}));
  return {title:data.article.title,citations:data.article.citations,sections};
 }
 if(Array.isArray(data.evidence))return {action:"finish",reason:"本地虚构表达演练",query:"",mode:"keyword",sources:data.evidence.slice(0,1).map(e=>e.id),questions:[],needsFacts:false};
 if(data.research){
  const spec=input.production;
  const names={"图文":["封面文案","正文","配图计划"],"口播稿":["开场","口播正文","字幕建议","目标时长（估算）"],"分镜脚本":["镜头顺序","画面建议","口播或对白","字幕","预计时长（估算）"],"自由文章":["正文"]}[spec.kind];
  const text="虚构示例："+input.topic+"。她把纸张铺平，圈出一个可以说清楚的动作。";
  const sections=names.map(name=>({name,text:name.includes("时长")?"约三十秒（估算）":spec.kind==="分镜脚本"?"镜头一："+text+"\n镜头二：她将修改后的文字放回桌上。":name==="配图计划"?"第一页：书桌与校样，突出修改动作。":text}));
  const body=sections.find(s=>["正文","口播正文","口播或对白"].includes(s.name));
  if(input.topic.includes("分歧演练"))body.text+="她停下来。她停下来。";
  if(input.topic.includes("会诊演练"))body.text+="蓝笔落在了桌上。她看了很久。她理好了纸张。";
  if(input.topic.includes("核验演练"))body.text+="考试报名日期为2027年5月1日。";
  if(input.topic.includes("长文演练"))body.text+="\n\n"+Array.from({length:30},(_,i)=>"第"+(i+1)+"段虚构观察：她比较修改前后的句子，记录动作如何改变读者注意的顺序。先写看得见的动作，再说明有限的判断，不把单个例子推广为普遍结论。").join("\n\n");
  return {title:input.topic,citations:data.research.supported.map(s=>s.sourceId),sections};
 }
 if(data.body)return assessment;
 throw Error("模拟服务不支持此请求");
}
