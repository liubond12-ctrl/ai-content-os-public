// Display guidance only: never changes queue state, permissions, or review verdicts.
export function taskGuidance(reason:string,hasArticle:boolean){
  if(reason.includes("AMBIGUOUS_QUOTE"))return {title:"审核原句位置待确认",detail:"审核引用在文章中出现多次，系统无法确定要修改哪一处。正文和已完成的意见已保留。",next:"打开编辑与审核，查看重复位置和上下文，人工修改后保存新版本；这不代表审核已通过。"};
  if(/未知回执|结果未知|用量未知/.test(reason))return {title:"调用结果待核实",detail:"请求可能已经执行，系统已暂停，避免重复调用和计费。",next:"查看执行记录与用量，核对服务商回执后再决定后续操作。"};
  if(/版本已变更|草稿已修改|版本冲突|保存冲突/.test(reason))return {title:"文章版本已变化",detail:"检测到其他修改，系统保留现有内容，没有覆盖新版本。",next:"打开编辑器核对最新版本与草稿，合并需要保留的修改后再保存。"};
  if(reason.includes("非关键主张需人工核对"))return {title:"审核标出了待核对内容",detail:"正文已保留，审核标出了需要人工确认的内容。",next:"打开正文，核对标出的原句和上下文，再决定是否修改。"};
  if(reason.includes("主观取舍或未解决分歧"))return {title:"审核意见待取舍",detail:"正文和各方审核意见已保留。",next:"打开正文与审核，对照角色意见和原句，决定保留还是修改。"};
  if(/资料不足|缺少资料|缺少证据|缺证|核心缺口/.test(reason))return {title:"资料不足，需补充",detail:hasArticle?"已有正文保留，缺少支持继续创作或核验的资料。":"尚未获得支持本次需求的充分资料。",next:"查看执行记录中的具体缺口，再补充允许使用的资料，或缩小需求范围后新建任务。"};
  return null;
}

export function quoteCandidates(article:{title:string;body:string},item:{field:"title"|"body";quote:string;before?:string;after?:string}){
  const value=article[item.field],options:Array<{offset:number;context:string}>=[];
  if(!item.quote)return options;
  for(let at=value.indexOf(item.quote);at>=0;at=value.indexOf(item.quote,at+1)){
    if(item.before&&!value.slice(0,at).endsWith(item.before))continue;
    if(item.after&&!value.startsWith(item.after,at+item.quote.length))continue;
    options.push({offset:at,context:value.slice(Math.max(0,at-40),at)+"【"+item.quote+"】"+value.slice(at+item.quote.length,at+item.quote.length+40)});
  }
  return options;
}
