import type {Review} from "./eval";
import type {Panel} from "./professional-review";
import {conflictGroups} from "./discussion-reader";
import type {MultiAgentReviewVisual,ReviewExpert,ReviewSuggestion} from "../types/multi-agent-review";

type Result = NonNullable<Review["result"]>;
const penalties = {"轻微":5,"明显":13,"严重":24};
const roleDimensions = {strategy:"内容策略",language:"表达质量",facts:"基础规范"} as const;

function suggestion(issue:Result["issues"][number],id:string,replacement?:string):ReviewSuggestion {
  const {field,quote,offset,reason,severity,suggestion} = issue;
  return {id,anchor:{field,quote,offset},problem:reason,suggestion,severity,replacement};
}

export function reviewVisual(version:number,panel:Panel|undefined,row:Review|undefined,resolved:ReadonlySet<string>):MultiAgentReviewVisual {
  const opinions = panel?.reviews.flatMap(review=>review.opinions)??[];
  const conflictIds = new Set(panel?.conflicts.flat()??[]);
  const conflicts = panel ? conflictGroups(panel).map(ids=>({
    id:ids.toSorted().join(":"),
    options:opinions.filter(opinion=>ids.includes(opinion.id)).map(opinion=>({
      id:opinion.id,role:opinion.role,anchor:opinion.issue,action:opinion.action,
      text:opinion.action==="retain"?opinion.issue.quote:opinion.replacement,reason:opinion.issue.reason,
    })),
    verdict:panel.verdict?.decisions.filter(decision=>decision.opinionIds.some(id=>ids.includes(id))).map(decision=>decision.reason).filter(Boolean).join(" "),
  })) : [];
  const conflictResolution = new Set(conflicts.filter(group=>resolved.has(group.id)).flatMap(group=>group.options.map(option=>option.id)));
  function score(result:Result,items:ReviewSuggestion[]){
    const missing = result.facts.checks.filter(check=>check.status!=="来源原文匹配");
    const deduction = items.reduce((sum,item)=>sum+(resolved.has(item.id)||conflictResolution.has(item.id)?0:penalties[item.severity]),0);
    return Math.max(0,(result.label==="优秀"?100:result.label==="普通"?90:72)-deduction-missing.reduce((sum,check)=>sum+(check.critical?22:8),0));
  }
  const experts:ReviewExpert[] = panel?.reviews.map(review=>{
    const items = review.result.issues.map((issue,index)=>{
      const opinion = review.opinions.find(o=>o.issue.field===issue.field&&o.issue.offset===issue.offset&&o.issue.quote===issue.quote);
      return suggestion(issue,opinion?.id??review.role+":"+index,opinion?.action==="replace"?opinion.replacement:opinion?.action==="delete"?"":undefined);
    });
    return {role:review.role,score:score(review.result,items),observation:review.result.dimensions[roleDimensions[review.role]],suggestions:items.filter(item=>!conflictIds.has(item.id))};
  })??[];
  if(!experts.length&&row?.result){
    const items = row.result.issues.map((issue,index)=>suggestion(issue,row.id+":"+index));
    experts.push({role:"basic",score:score(row.result,items),observation:row.result.dimensions["内容策略"],suggestions:items});
  }
  const common = opinions.find((opinion,index)=>opinions.slice(index+1).some(other=>other.role!==opinion.role&&other.issue.quote===opinion.issue.quote&&other.issue.offset===opinion.issue.offset&&other.issue.field===opinion.issue.field));
  const summary = [
    common&&"多位专家关注「"+common.issue.quote+"」。",
    conflicts.length>0&&"有 "+conflicts.length+" 处修改方案需要取舍。",
    panel?.reason||conflicts.find(group=>group.verdict)?.verdict,
  ].filter((line):line is string=>typeof line==="string"&&line.length>0);
  const exchanges = panel?.discussion.flatMap((entry,index)=>entry.responses.map((response,i)=>{
    return {id:index+":"+i,role:entry.role,stance:response.position,message:response.reason||"此条回应未记录理由。"} as const;
  }))??[];
  return {version,summary,experts,conflicts,exchanges};
}
