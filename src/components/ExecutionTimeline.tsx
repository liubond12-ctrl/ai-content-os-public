import type {Flow} from "@/studio/collaboration";
import type {Task} from "@/studio/tasks";
import {reviewRoleLabels} from "@/studio/discussion-reader";

const work:Record<string,[string,string]> = {
  assemble:["规则装配","匹配账号与写作规范"],
  retrieve:["资料检索","检索本次写作参考"],
  research:["研究","整理证据并核对事实缺口"],
  write:["初稿写作","生成当前稿件正文"],
  eval:["审核","检查当前版本"],
  merge:["协作审核","汇总独立意见并检查分歧"],
  revision:["定向修订","把已确认的修改应用到正文"],
  queue:["后台队列","等待领取"],
  pendingReview:["协作审核","等待下一步"],
  pendingRevision:["定向修订","等待执行"],
};

function describeExecution(step:string){
  const roleId=step.replace(/^discussion:/,"");
  if(Object.hasOwn(reviewRoleLabels,roleId)){
    const role=roleId as keyof typeof reviewRoleLabels;
    const action=step.startsWith("discussion:")?"回应本角色涉及的分歧":role==="judge"?"核对分歧并确定处理意见":"独立审核当前版本";
    return {actor:reviewRoleLabels[role],action,role};
  }
  const [name,detail]=work[step]??["后台","执行已记录的步骤"];
  return {actor:"系统",action:name+" · "+detail};
}

export function ExecutionTimeline({task,status,flow}:{task:Task;status:string;flow:Flow|null}){
  const executions=task.stage==="done"?flow?.executions??[]:[];
  const active=task.stage==="done"&&flow?.state==="running"?executions.at(-1):undefined;
  const systemStep=status==="排队"?"queue":status==="修订"?"pendingRevision":status==="审核"?"pendingReview":task.stage;
  const current=describeExecution(active?.role??systemStep);
  const isRunning=active||status==="生成"||status==="整理资料";
  return <section className="task-run" aria-labelledby="task-run-title">
    <h2 id="task-run-title">执行进度</h2>
    <div className="task-current" data-role={current.role} aria-current="step">
      <span>{isRunning?"正在执行":status==="排队"?"已提交":"等待后台更新"} · {current.role?"审核角色":"系统步骤"}</span>
      <strong>{current.actor} · {current.action}</strong>
      {active?.inputArticleVersion&&<small>审核文章 v{active.inputArticleVersion}</small>}
    </div>
    <ol className="task-run-list">
      {task.records.filter(record=>record.status==="ok"&&work[record.node]).map((record,index)=><li key={record.node+"-"+index} data-state="done">
        <span className="task-run-mark" aria-hidden="true">✓</span>
        <div><strong>系统 · {describeExecution(record.node).action}</strong><small>已完成</small></div>
      </li>)}
      {executions.filter(step=>step.ended&&step.id!==active?.id).map(step=>{
        const {actor,action,role}=describeExecution(step.role);
        const done=["ready","awaiting_acceptance"].includes(step.status);
        return <li key={step.id} data-role={role} data-state={done?"done":"recorded"}>
          <span className="task-run-mark" aria-hidden="true">{done?"✓":"•"}</span>
          <div><strong>{actor} · {action}</strong><small>{done?"已完成":step.status==="human"?"待人工处理":"执行记录已保存"}{step.inputArticleVersion?" · v"+step.inputArticleVersion:""}</small></div>
        </li>;
      })}
    </ol>
  </section>;
}
