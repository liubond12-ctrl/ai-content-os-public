"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {editorHref} from "@/studio/article-navigation";
import type {Flow} from "@/studio/collaboration";
import type {Panel,Opinion} from "@/studio/professional-review";
import {conflictGroups,exactRevision,opinionDecision,reviewRoleLabels,type VersionText} from "@/studio/discussion-reader";
import {textDiff} from "@/studio/article-document";
import "./discussion-reader.css";

const verdictLabels={accept:"采纳",merge:"合并",reject:"不采纳",human:"交作者取舍"};
type Anchor=Pick<Opinion["issue"],"quote"|"offset"|"field">;
type Locate=(version:number,issue:Anchor)=>void;
type Evidence={versions:VersionText[];mode:string|null};
function savedConclusion(p:Panel,f:Flow){
  const failed=f.panels?.at(-1)?.id===p.id&&f.state==="failed";
  if(failed&&p.phase==="judge"&&!p.verdict)return {title:"Judge 未形成有效裁决",next:"请对照原句、意见和回应，在编辑器人工取舍。核对执行记录后再决定是否重试。"};
  const facts=p.reviews.flatMap(r=>r.result.facts.checks).filter(c=>c.status!=="来源原文匹配");
  if(facts.some(c=>c.critical)||p.reviews.some(r=>r.result.status==="blocked"))return {title:"事实或安全检查受阻",next:"核对下方引用和来源；补充可核实的依据，或在正文删除、改写缺证断言。"};
  if(facts.length||p.reviews.some(r=>r.result.facts.requestTriggered&&!r.result.facts.checks.length))return {title:"仍有主张需要核对",next:"查看原句与对应来源，判断是文本观察还是需要证据的事实陈述。"};
  if(p.status==="human")return {title:"待作者取舍",next:"展开争议查看双方理由，决定保留或修改原句，再在编辑器保存新版本。"};
  if(p.status==="pass")return {title:"本轮审核通过",next:"审阅正式正文后，由作者决定是否定稿。"};
  if(p.status==="revise")return {title:"本轮建议修订",next:"核对已选意见和实际版本差异，查看新版复审结果。"};
  return {title:failed?"审核执行失败":"本轮尚无最终结论",next:failed?"查看执行原因并人工核对已有意见。":"查看已保存的独立意见与执行记录。"};
}
function changeLabel(o:Opinion){return o.action==="retain"?"保留原句":o.action==="delete"?"删除原句":"替换为「"+o.replacement+"」";}
function VersionDiff({before,after}:{before:VersionText;after:VersionText}){
  const diffs=(["title","body"] as const).filter(k=>before[k]!==after[k]);
  return <details><summary>对照正式版本 v{before.version} → v{after.version}</summary>{diffs.length?diffs.map(k=>{
    const d=textDiff(before[k],after[k]);return <div key={k}><p>{k==="body"?"正文":"标题"} · 改动区间</p><pre>{d.prefix.slice(-32)}<del>{d.removed}</del><ins>{d.added}</ins>{d.suffix.slice(0,32)}</pre></div>;
  }):<p>所存标题与正文文字相同。</p>}</details>;
}
function Round({p,f,versions,mode,taskId,onLocate,returnTo}:{p:Panel;f:Flow;versions:VersionText[];mode:string|null;taskId:string;onLocate?:Locate;returnTo?:string}){
  const base=versions.find(v=>v.version===p.articleVersion);
  const revisions=versions.filter(v=>v.origin==="ai-revision"&&v.revisionReviewId===p.id&&v.parentVersion===p.articleVersion);
  const children=versions.filter(v=>v.parentVersion===p.articleVersion&&v.origin!=="ai-revision");
  const all=p.reviews.flatMap(r=>r.opinions);
  const groups=conflictGroups(p),single=all.filter(o=>!groups.some(ids=>ids.includes(o.id)));
  function anchor(i:Anchor){
    if(!base||!i.quote||base[i.field].slice(i.offset,i.offset+i.quote.length)!==i.quote)return <small>对应版本或原句位置未能核对</small>;
    return onLocate?<button type="button" onClick={()=>onLocate(p.articleVersion,i)}>定位 v{p.articleVersion} 原句</button>:<Link href={editorHref(taskId,returnTo,{version:String(p.articleVersion),field:i.field,at:String(i.offset),length:String(i.quote.length)})}>定位 v{p.articleVersion} 原句 →</Link>;
  }
  function issue(ids:string[],disputed:boolean){
    const ops=ids.flatMap(id=>all.filter(o=>o.id===id));
    const anchors=[...new Map(ops.map(o=>[o.issue.field+":"+o.issue.offset+":"+o.issue.quote,o.issue])).values()];
    const responses=p.discussion.flatMap(d=>d.responses.filter(r=>ids.includes(r.opinionId)).map(r=>({role:d.role,...r})));
    const decisions=p.verdict?.decisions.filter(d=>d.opinionIds.some(id=>ids.includes(id)))||[];
    const changed=[...new Map(ops.filter(o=>p.selected.some(a=>a.id===o.id)&&o.action!=="retain").map(o=>[o.issue.field+":"+o.issue.offset+":"+o.issue.quote,o])).values()];
    return <details key={ids.join("/")} className="dr-issue"><summary><span>{disputed?"争议":"独立意见"}</span> {anchors[0]?(anchors[0].quote.length>66?anchors[0].quote.slice(0,65)+"…":anchors[0].quote):"引用的意见缺少原句记录"}</summary>
      <div className="dr-inside">{anchors.map((i,n)=><div key={n}><blockquote>{i.quote}</blockquote>{anchor(i)}</div>)}
      {ops.length<ids.length&&<p>部分意见 ID 没有对应记录。</p>}
      <h4>独立意见</h4><div className="dr-opinions">{ops.map(o=><p key={o.id}><strong>{reviewRoleLabels[o.role]} · {changeLabel(o)}</strong><br/>{o.issue.reason}<br/><small>依据：{o.evidenceIds.join("、")||"未附来源编号"}</small></p>)}</div>
      {disputed&&<><h4>讨论回应</h4>{responses.length?responses.map((r,n)=><p key={n}>{reviewRoleLabels[r.role]} · {r.position==="withdraw"?"撤回":"维持"}对「{ops.find(o=>o.id===r.opinionId)?.issue.quote||"原意见"}」的意见：{r.reason}{r.evidenceIds.length>0&&" · 依据 "+r.evidenceIds.join("、")}</p>):<p>没有已保存的回应。</p>}
      <h4>Judge 裁决</h4>{decisions.length?decisions.map((d,n)=><p key={n}>{verdictLabels[d.action]} · {d.reason}{d.selectedIds.length>0&&<><br/>选定：{d.selectedIds.map(id=>{const o=all.find(a=>a.id===id);return o?reviewRoleLabels[o.role]+" · "+changeLabel(o):"缺少对应意见";}).join("、")}</>}{d.evidenceIds.length>0&&" · 依据 "+d.evidenceIds.join("、")}</p>):<p>{p.reason|| (p===f.panels?.at(-1)&&f.state==="failed"?f.reason:"暂无有效裁决记录。")}</p>}</>}
      <h4>实际修改</h4>{revisions.map(v=><div key={v.version}><strong>正式版本 v{p.articleVersion} → v{v.version}</strong>{base&&exactRevision(p,base,v)?(changed.length?changed.map(o=><p key={o.id}><del>{o.issue.quote}</del> → <ins>{o.action==="delete"?"（已删除）":o.replacement}</ins></p>):<p>此组没有绑定具体替换，请对照版本差异。</p>):<p>已保存修订版本，逐条对应关系未能核实，请查看版本差异。</p>}<p>复审：{f.panels?.find(panel=>panel.articleVersion===v.version)?.reason||"尚无已保存结论"}</p></div>)}
      {children.filter(v=>ops.some(o=>opinionDecision(v,p,o))).map(v=><p key={v.version}>作者决定 · v{v.version} · {v.decision?.choice==="retain"?"保留":"采纳修改"} · {v.decision?.reason}</p>)}
      {!revisions.length&&!children.some(v=>ops.some(o=>opinionDecision(v,p,o)))&&<p>未找到与这条意见绑定的正式修改。</p>}</div></details>;
  }
  const checks=p.reviews.flatMap(r=>r.result.facts.checks.map(c=>({role:r.role,...c})));
  return <div className="dr-round">
    <section className="dr-discussion" aria-label="讨论回应">
      <h4>讨论{groups.length>0&&<small>{groups.length} 个争议点</small>}</h4>
      {groups.length?groups.map(ids=>{
        const opinions=all.filter(o=>ids.includes(o.id));
        const decisions=p.verdict?.decisions.filter(d=>d.opinionIds.some(id=>ids.includes(id)))??[];
        const changes=[...new Map(opinions.filter(o=>p.selected.some(selected=>selected.id===o.id)&&o.action!=="retain").map(o=>[o.issue.field+":"+o.issue.offset,o])).values()];
        const revision=base&&revisions.find(v=>exactRevision(p,base,v));
        return <section key={ids.join("/")} className="dr-dispute">
          <h5>{[...new Set(opinions.map(o=>"「"+o.issue.quote+"」"))].join("、")||"缺少原句记录"}</h5>
          <ul>{opinions.map(opinion=>{
            const response=p.discussion.find(d=>d.role===opinion.role)?.responses.find(r=>r.opinionId===opinion.id);
            return <li data-role={opinion.role} key={opinion.id}>
              <strong>{reviewRoleLabels[opinion.role]} · {changeLabel(opinion)}</strong>
              <p>{opinion.issue.reason?.trim()||"未记录具体理由"}</p>
              {response&&<small>讨论中{response.position==="withdraw"?"撤回":"维持"}此意见 · {response.reason?.trim()||"未记录具体回应理由"}</small>}
            </li>;
          })}</ul>
          {decisions.length?decisions.map((decision,index)=><article className="dr-verdict" key={index}>
            <strong>裁决 · {verdictLabels[decision.action]}</strong>
            {decision.selectedIds.map(id=>{
              const opinion=all.find(o=>o.id===id);
              return opinion?<p key={id} className="dr-selected" data-role={opinion.role}>{reviewRoleLabels[opinion.role]} · {changeLabel(opinion)}</p>:<p key={id}>缺少对应的采纳意见记录</p>;
            })}
            <p>{decision.reason?.trim()||"未记录具体裁决理由"}</p>
          </article>):<p>暂无已保存的裁决。</p>}
          {revision&&changes.length>0&&<div className="dr-impact"><strong>正式正文 v{p.articleVersion} → v{revision.version}</strong>
            {changes.map(opinion=>{
              const {field,offset,quote}=opinion.issue;
              const source=base![field];
              const contextual=p.selected.filter(o=>o.action!=="retain"&&o.issue.field===field).every(o=>o.issue.offset===offset);
              const before=contextual?"…"+source.slice(Math.max(0,offset-14),offset):"";
              const after=contextual?source.slice(offset+quote.length,offset+quote.length+12)+"…":"";
              return <div key={opinion.id}><p><span>改前</span> {before}<del>{quote}</del>{after}</p>
                <p><span>改后</span> {before}{opinion.action==="replace"?<ins>{opinion.replacement}</ins>:!contextual?"该处已删除":null}{after}</p></div>;
            })}
          </div>}
          {revisions.length>0&&!revision&&<p>已保存修订版本，逐条修改关系待核对。</p>}
        </section>;
      }):<p>{p.phase==="complete"?"无实质分歧 · 已跳过讨论":"暂无已记录的争议点。"}</p>}
    </section>
    {p.reviews.length>0&&<section className="dr-roles" aria-label="审核角色">
      <h4>审核角色</h4>
      {p.reviews.map(review=><details className="dr-role" data-role={review.role} key={review.role}>
        <summary><strong>{reviewRoleLabels[review.role]}</strong><span>{review.opinions.length?review.opinions.length+" 条意见":review.result.facts.checks.length?review.result.facts.checks.length+" 条事实记录":"已完成检查"}</span></summary>
        <div className="dr-inside">
          {Object.entries(review.result.dimensions??{}).map(([name,value])=><p key={name}><strong>{name}</strong> · {value}</p>)}
          {review.opinions.map(opinion=><p key={opinion.id}>{changeLabel(opinion)} · {opinion.issue.reason}</p>)}
          {review.result.facts.checks.map((check,index)=><p key={index}>{check.quote} · {check.status}</p>)}
        </div>
      </details>)}
    </section>}
    {groups.length>0&&<h4>分歧依据 · {groups.length} 个争议点</h4>}

    {groups.map(ids=>issue(ids,true))}{single.map(o=>issue([o.id],false))}
    {checks.map((c,n)=><details className="dr-issue" key={n}><summary><span>{c.critical?"关键事实":"事实核验"}</span> {c.quote}</summary><div className="dr-inside"><p>{reviewRoleLabels[c.role]} · {c.status} · 来源 {c.sourceId||"未提供"}</p>{anchor(c)}</div></details>)}
    {(revisions.length>0||children.length>0)&&<section><h4>后续正式版本</h4>{[...revisions,...children].map(v=><div key={v.version}><p><strong>v{v.version} · {v.origin==="ai-revision"?(mode==="真实云端"?"确定性修订":mode?"模型定向修订":"定向修订（执行模式未记录）"):v.origin==="restore"?"作者恢复历史版本":"作者保存新版"}</strong>{v.confirmed?" · 已定稿":""}</p>{v.decision?<p>作者记录：{v.decision.reason}</p>:v.origin==="human"&&<p>没有绑定逐条取舍理由。</p>}{base&&<VersionDiff before={base} after={v}/>}</div>)}</section>}
    <details><summary>完整审核记录</summary><pre>{JSON.stringify(p,null,2)}</pre></details>
  </div>;
}
function AuthorReview({round,head,history,taskId,status,bodyHref,returnTo}:{round:Panel;head?:VersionText;history:VersionText[];taskId:string;status:string;bodyHref:string;returnTo?:string}){
  const before=history.find(v=>v.version===round.articleVersion);
  const revised=head&&before&&head.version!==before.version&&exactRevision(round,before,head);
  const opinions=round.reviews.flatMap(review=>review.opinions);
  const changes=[...new Map(round.selected.filter(o=>o.action!=="retain").map(o=>[o.issue.field+":"+o.issue.offset,o])).values()];
  const factChecks=[...new Map(round.reviews.flatMap(r=>r.result.facts.checks)
    .filter(check=>check.status!=="来源原文匹配").map(check=>[check.field+":"+check.offset,check])).values()];
  const needsFacts=status==="受阻"&&factChecks.length>0;
  return <section className="author-review" aria-label="待作者处理的审核结果">
    <p className="author-review-status">{head?.confirmed?"作者已定稿":needsFacts?"有事实待核验":status==="待人工审核"?(revised?"机器复审完成":"机器审核完成")+" · 待你确认定稿":status}</p>
    <h2>{revised&&changes.length>0?"请核对已改动的正文":needsFacts?"先核对标出的原句":head?.confirmed?"查看已确认的正文":"请阅读正文后确认"}</h2>
    {revised&&changes.length>0?<div className="author-review-changes" aria-label="实际修改">{changes.map(o=>{
      const {field,offset,quote}=o.issue, text=before![field];
      const left=text.slice(0,offset).split(/\n+/).at(-1)?.slice(-52)??"";
      const right=text.slice(offset+quote.length).split(/\n+/)[0]?.slice(0,52)??"";
      return <div key={o.id} className="author-change">
        <p><small>改前</small><span>{left}<del>{quote}</del>{right}</span></p>
        <p><small>改后</small><span>{left}{o.action==="replace"&&<ins>{o.replacement}</ins>}{right||(!left&&o.action==="delete"?"该处已删除":"")}</span></p>
      </div>;
    })}</div>:needsFacts?<blockquote className="author-review-fact">{factChecks[0].quote}</blockquote>:null}
    <p className="author-review-next">{head?.confirmed?"可打开文章查看已经定稿的版本。":needsFacts?"打开正文，补充可核实的依据，或改写这句，再确认定稿。":"打开正文核对上下文，满意后确认定稿，也可以继续修改。"}</p>
    <div className="author-review-actions"><Link className="author-primary" href={bodyHref}>{needsFacts?"打开正文并处理":"打开正文"}</Link></div>
    {before&&<details className="author-evidence">
      <summary>查看角色讨论与依据</summary>
      <p>审核 v{round.articleVersion}{revised&&head?"，修改保存为 v"+head.version:""}。</p>
      {opinions.length>0?<ul>{opinions.map(o=>{
        const reply=round.discussion.find(d=>d.role===o.role)?.responses.find(r=>r.opinionId===o.id);
        return <li key={o.id} data-role={o.role}><strong>{reviewRoleLabels[o.role]} · {changeLabel(o)}</strong>
          <p>{o.issue.reason?.trim()||"未记录具体理由"}</p>{reply&&<p>{reply.position==="withdraw"?"撤回意见":"维持原意见"} · {reply.reason?.trim()||"未记录具体回应理由"}</p>}
          {o.evidenceIds.length>0&&<small>来源 · {o.evidenceIds.join("、")}</small>}
        </li>;
      })}</ul>:<p>本轮没有保存分歧意见。</p>}
      {round.verdict?.decisions.map((decision,i)=><div key={i}><strong>裁决 · {verdictLabels[decision.action]}</strong>
        {decision.selectedIds.map(id=>{const op=opinions.find(o=>o.id===id);return op?<p key={id}>{reviewRoleLabels[op.role]} · {changeLabel(op)}</p>:<p key={id}>缺少采纳意见记录</p>;})}
        <p>{decision.reason?.trim()||"未记录裁决理由"}</p></div>)}
      {factChecks.map(check=><p key={check.field+":"+check.offset}>{check.quote} · {check.status}</p>)}
      {revised&&head&&<VersionDiff before={before} after={head}/>}
      <Link href={editorHref(taskId,returnTo,{version:String(round.articleVersion)})}>查看当时的正文 v{round.articleVersion}</Link>
    </details>}
  </section>;
}
export function DiscussionReader({flow:f,taskId,versions,onLocate,showRecentDispute=false,authorView,returnTo}:{flow:Flow;taskId:string;versions?:VersionText[];onLocate?:Locate;showRecentDispute?:boolean;authorView?:{status:string;bodyHref:string};returnTo?:string}){
  const [choice,setChoice]=useState(""),[evidence,setEvidence]=useState<Evidence|null>(null),[failed,setFailed]=useState(false);
  const supplied=!!versions?.length;
  useEffect(()=>{let active=true;const get=async()=>{try{const r=await fetch("/api/collaboration?"+new URLSearchParams({taskId,view:"evidence",modeOnly:supplied?"1":"0"}),{cache:"no-store"});if(!r.ok)throw Error();const d=await r.json();if(active){setEvidence(d);setFailed(false);}}catch{if(active)setFailed(true);}};void get();window.addEventListener("focus",get);return()=>{active=false;window.removeEventListener("focus",get);};},[taskId,f.revision,supplied]);
  const history=supplied?versions!:evidence?.versions||[],head=history.reduce<VersionText|undefined>((a,b)=>!a||a.version<b.version?b:a,undefined);
  const rounds=f.panels||[],latest=rounds.at(-1);
  const relatedDispute=showRecentDispute&&latest?.status==="pass"&&head?.version===latest.articleVersion&&!conflictGroups(latest).length
    ?rounds.findLast(round=>conflictGroups(round).length>0&&history.some(version=>version.version===latest.articleVersion&&version.revisionReviewId===round.id))
    :undefined;
  const p=rounds.find(r=>r.id===choice)||relatedDispute||latest;
  if(!p&&authorView)return <div className="author-review"><p>{authorView.status}</p><Link className="author-primary" href={authorView.bodyHref}>打开正文</Link></div>;
  if(!p)return <div className="dr-summary"><strong>{f.reason||"尚无专业审核轮次"}</strong><p>暂无可展开的争议记录。</p></div>;
  const incomplete=!Array.isArray(p.reviews)||!Array.isArray(p.conflicts)||!Array.isArray(p.discussion)||!Array.isArray(p.selected)||p.reviews?.some(r=>!Array.isArray(r.opinions)||!Array.isArray(r.result?.facts?.checks));
  if(incomplete)return <section className="dr-summary"><h3>文章 v{p.articleVersion} · 轮次记录不完整</h3><p>{p.reason||"缺少完整的角色、冲突或回应记录。"}</p><details><summary>查看已保存记录</summary><pre>{JSON.stringify(p,null,2)}</pre></details><label>审核轮次 <select value={p.id} onChange={e=>setChoice(e.target.value)}>{rounds.map(r=><option key={r.id} value={r.id}>文章 v{r.articleVersion}</option>)}</select></label></section>;
  if(authorView)return <AuthorReview round={p} head={head} history={history} taskId={taskId} returnTo={returnTo} {...authorView}/>;
  const conclusion=savedConclusion(p,f),historical=head&&head.version!==p.articleVersion;
  const compact=p===relatedDispute&&historical;
  const author=history.find(v=>v.parentVersion===p.articleVersion&&v.decision?.review===p.id);
  return <section className="discussion-reader" aria-label="按争议点阅读"><div className="dr-summary"><div className="dr-top"><span>{historical?"历史审核":head?"当前版本":"审核版本"} · v{p.articleVersion}</span><span>{evidence?.mode==="真实云端"?"历史真实云端记录":evidence?.mode==="离线示例"?"离线测试样例":evidence?.mode||"执行模式未记录"}</span></div>
  {compact?<h3>v{p.articleVersion} 分歧 · v{head.version} 复审通过</h3>:<>
  <h3>{author?"已记录作者决定":conclusion.title}</h3>{author&&<p>作者在 v{author.version} 记录：{author.decision?.reason}</p>}{(p.reason||p.id===rounds.at(-1)?.id&&f.reason)&&<p>{p.reason||f.reason}</p>}
  <p><strong>{historical?"当前稿件":"待办"}　</strong>{historical?"正式正文已到 v"+head.version+(head.confirmed?"，作者已定稿。":"。")+(latest?.articleVersion===head.version&&latest.status==="pass"?"复审通过。":!rounds.some(r=>r.articleVersion===head.version)?"没有该版本的复审记录。":"可切换至该版本的审核轮次。"):head?.confirmed?"作者已定稿。":conclusion.next}</p>
  {p===rounds.at(-1)&&f.reason&&p.reason&&f.reason!==p.reason&&<p>流程记录：{f.reason}</p>}</>}
  {!compact&&rounds.length>1&&<label>审核轮次 <select value={p.id} onChange={e=>setChoice(e.target.value)}>{rounds.slice().reverse().map(r=><option key={r.id} value={r.id}>文章 v{r.articleVersion} · 第 {rounds.indexOf(r)+1} 轮</option>)}</select></label>}</div>
  {failed&&<p role="alert">版本资料读取失败，可刷新页面重试。</p>}
  {rounds.filter(r=>r.id!==p.id&&conflictGroups(r).length>0).map(r=><button className="dr-jump" key={r.id} type="button" onClick={()=>setChoice(r.id)}>查看 v{r.articleVersion} 的 {conflictGroups(r).length} 个争议点</button>)}
  <Round key={p.id} p={p} f={f} versions={history} mode={evidence?.mode||null} taskId={taskId} onLocate={onLocate} returnTo={returnTo}/>
  {compact&&<label className="dr-round-picker">审核轮次 <select value={p.id} onChange={e=>setChoice(e.target.value)}>{rounds.slice().reverse().map(r=><option key={r.id} value={r.id}>文章 v{r.articleVersion} · 第 {rounds.indexOf(r)+1} 轮</option>)}</select></label>}</section>;
}