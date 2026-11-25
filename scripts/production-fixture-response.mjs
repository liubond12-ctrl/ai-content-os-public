// Deterministic local fixture. Never represents real model or business-quality validation.
export function fixtureResponse(instruction,data){
 const request=data.input??data.request;
 const source=request?.production?.sourceMaterials?.[0];
 const input=source?{...request,topic:source.title}:request;
 const assessment={label:"普通",disputed:false,dimensions:{内容策略:"离线结构检查",表达质量:"明确虚构",内容结构:"按栏目组织",基础规范:"业务标准未配置"},issues:[],claims:[]};
 if(instruction.startsWith("渠道派生 v1")){
  const {variant}=data;
  const common={variant,keywords:["写作练习","动作描写","校样"],cta:"在评论区写下你想精修的一句。"};
  if(variant==="xiaohongshu")return {...common,
   titles:["一句动作写出犹豫","蓝笔落桌怎么改","校样里的动作描写"],
   body:"🖊️ 写作练习：把蓝笔放在校样旁，读者就有了能看见的动作。\n\n📌 风险演练原句：加我微信；这不是发布文案，请在复制前删掉这行。",
   tags:["写作练习","动作描写","改稿","校样","语言表达","写作入门","怎样写动作","改写犹豫的句子"],
   comments:[{question:"为什么先写动作？",answer:"我是本文作者，我想让读者先看到她做了什么。"},{question:"原句一定要改吗？",answer:"可以保留，取决于节奏取舍。"},{question:"从哪句练起？",answer:"试着删掉一句抽象评价，再补一个动作。"}]};
  if(variant==="douyin-script")return {...common,title:"动作描写写作练习",
   hooks:["蓝笔一放，犹豫就出来了。","同一句话，我改成了两种动作。","抽象句怎么改？先看纸角。"],
   script:"[画面提示] 蓝笔和校样特写。\n你看，她没有说犹豫。她把同一行读了三遍。\n[重音停顿] 三遍。\n风险预检样例：绝对有效，交付前删掉这句。"};
  if(variant==="douyin-post")return {...common,title:"蓝笔校样改写",slides:["第 1 页 · 从一句判断开始","第 2 页 · 她把蓝笔横放在校样旁。","第 3 页 · 标出你读到的动作。绝对有效是用于预检的虚构样例词。"]};
  if(variant==="wechat")return {...common,title:"从一张校样说起：写作练习的三个观察点",
   blocks:[{kind:"paragraph",text:"动作描写可以从手边的纸、笔和停顿开始。蓝笔落桌，是这次虚构校样的一个节点。"},
    {kind:"quote",text:"蓝笔落在了桌上。"},
    {kind:"highlight",text:"先让读者看到动作，再决定要不要解释感受。"},
    {kind:"step",text:"第一步，圈出抽象判断。第二步，挑一个可见动作。第三步，读一遍改前改后。"},
    {kind:"paragraph",text:"风险演练：稳赚不赔是待清理的营销承诺。"}]};
 }
 if(instruction.startsWith("局部精修：写一句"))return {text:"如果是你，会用哪个动作表现她的犹豫？"};
 if(instruction.startsWith("局部精修：按建议"))return {text:"她把纸角压平，指尖沿着折痕缓慢滑过。"};
 if(instruction.startsWith("你是独立")){
  const quote="她停下来。";
  const body=String(data.body),offset=body.lastIndexOf(quote);
  if(source?.id==="feishu-demo:paper"){
   const anchor="她把纸张铺平。",at=body.indexOf(anchor);
   if(at>=0){
    const strategy=instruction.includes("回应需求");
    const replacement=strategy?"她用掌心抚平纸角。":"她沿折痕缓缓压了两遍。";
    assessment.issues=[{field:"body",quote:anchor,offset:at,type:"表达",severity:"轻微",reason:strategy?"具体动作更容易画面化":"放慢动作能保留原段的停顿",suggestion:replacement}];
    return {assessment,actions:[{issueIndex:0,action:"replace",replacement,evidenceIds:[],blocking:false}]};
   }
  }
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
 if(instruction.startsWith("你是Judge")&&(input?.topic?.includes("会诊演练")||source?.id==="feishu-demo:paper"))return {decisions:data.conflicts.map(opinionIds=>({opinionIds,action:"human",selectedIds:[],reason:"两种改法突出不同观察点，由作者按文章重心取舍。",evidenceIds:[]}))};
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
  if(source?.id==="feishu-demo:paper")body.text+="她把纸张铺平。";
  if(input.topic.includes("分歧演练"))body.text+="她停下来。她停下来。";
  if(input.topic.includes("核验演练"))body.text+="考试报名日期为2027年5月1日。";
  if(input.topic.includes("长文演练"))body.text+="\n\n"+Array.from({length:input.topic.includes("会诊演练")?120:30},(_,i)=>"第"+(i+1)+"段虚构观察：她比较修改前后的句子，记录动作如何改变读者注意的顺序。先写看得见的动作，再说明有限的判断，不把单个例子推广为普遍结论。").join("\n\n");
  if(input.topic.includes("会诊演练"))body.text+=(input.topic.includes("长文演练")?"\n\n":"")+"蓝笔落在了桌上。她看了很久。她理好了纸张。";
  return {title:input.topic,citations:data.research.supported.map(s=>s.sourceId),sections};
 }
 if(data.body)return assessment;
 throw Error("模拟服务不支持此请求");
}
