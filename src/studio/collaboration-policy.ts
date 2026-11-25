/** Pure decisions only: no model calls, retries, publishing or database writes. */
export type CollaborationDecision =
  | {state:"awaiting_acceptance";reason:string}
  | {state:"revision";reason:string}
  | {state:"human";reason:string}
  | {state:"failed";reason:string}
  | {state:"unknown";reason:string};
export interface ReviewInput {
  articleVersion:number;
  status:string;
  error?:string;
  result?:{
    disputed:boolean;
    issues:Array<{type:string;reason:string}>;
    facts:{checks:Array<{status:string}>};
  };
}
export function decideReview(review:ReviewInput, inputVersion:number, revisions:number):CollaborationDecision {
  if(!Number.isInteger(revisions)||revisions<0)throw Error("Invalid revision count");
  if(review.articleVersion!==inputVersion)return {state:"failed",reason:"审核与输入文章版本不一致"};
  if(review.status==="running")return {state:"unknown",reason:"审核请求结果尚未确认，不得自动重试"};
  if(review.status==="failed")return {state:"failed",reason:review.error??"审核执行失败"};
  const result=review.result;
  if(!result&&review.status==="human_review")return {state:"human",reason:review.error??"需要人工判断"};
  if(!result)return {state:"failed",reason:"审核缺少结构化结果"};
  if(result.disputed||result.facts.checks.some(c=>c.status!=="来源原文匹配")||["blocked","human_review"].includes(review.status))
    return {state:"human",reason:"存在待核实事实、资料缺口或主观取舍，需要人工处理"};
  if(review.status==="pass"&&!result.issues.length)return {state:"awaiting_acceptance",reason:"审核通过，待人工验收；未发布"};
  if(review.status!=="revise")return {state:"failed",reason:"审核状态与结构化结果不一致"};
  if(!result.issues.length||result.issues.some(i=>!["表达","结构"].includes(i.type)))
    return {state:"human",reason:result.issues.map(i=>i.reason).join("；")||"缺少可自动修订的明确问题"};
  if(revisions>=2)return {state:"human",reason:"已达到最多两轮自动修订，仍需人工处理"};
  return {state:"revision",reason:result.issues.map(i=>i.reason).join("；")};
}
export interface ExecutionFence {revision:number;articleVersion:number;draftRevision:number;stopped:boolean}
export function mayCommitResult(before:ExecutionFence,current:ExecutionFence):boolean {
  return !before.stopped&&!current.stopped&&before.revision===current.revision&&
    before.articleVersion===current.articleVersion&&before.draftRevision===current.draftRevision;
}
