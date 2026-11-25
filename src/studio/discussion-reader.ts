import type {Panel,Opinion} from "./professional-review";
import type {ArticleSnapshot} from "./article-store";

export const reviewRoleLabels={strategy:"内容策略",language:"语言表达",facts:"事实核验",judge:"综合裁决"} as const;

export type VersionText=Pick<ArticleSnapshot,"version"|"parentVersion"|"title"|"body"|"confirmed"|"origin"|"decision"|"revisionReviewId"|"restoredFrom">;
export function conflictGroups(p:Pick<Panel,"conflicts">){
  const groups:string[][]=[];
  for(const edge of p.conflicts??[]){
    const group=new Set(edge);
    for(let i=groups.length-1;i>=0;i--)if(groups[i].some(id=>group.has(id))){
      groups[i].forEach(id=>group.add(id));groups.splice(i,1);
    }
    if(group.size)groups.push([...group]);
  }
  return groups;
}
export function opinionDecision(v:VersionText,p:Panel,o:Opinion){
  const d=v.decision;
  if(!d||v.parentVersion!==p.articleVersion||d.review!==p.id)return false;
  if(d.opinionId)return d.opinionId===o.id;
  const i=p.aggregate?.result?.issues[d.issue];
  return !!i&&i.field===o.issue.field&&i.offset===o.issue.offset&&i.quote===o.issue.quote&&
    p.selected.filter(a=>a.action!=="retain"&&a.issue.field===i.field&&a.issue.offset===i.offset&&a.issue.quote===i.quote).length===1&&p.selected.some(a=>a.id===o.id);
}
export function exactRevision(p:Panel,base:VersionText,next:VersionText){
  if(base.version!==p.articleVersion||next.parentVersion!==base.version||next.origin!=="ai-revision"||next.revisionReviewId!==p.id)return false;
  for(const field of ["body","title"] as const){
    let value=base[field],end=value.length;
    const ops=new Map(p.selected.filter(o=>o.action!=="retain"&&o.issue.field===field).map(o=>[o.issue.offset+":"+o.issue.quote.length,o]));
    for(const o of [...ops.values()].sort((a,b)=>b.issue.offset-a.issue.offset)){
      const {offset,quote}=o.issue;
      if(offset<0||offset+quote.length>end||value.slice(offset,offset+quote.length)!==quote)return false;
      value=value.slice(0,offset)+(o.action==="delete"?"":o.replacement)+value.slice(offset+quote.length);end=offset;
    }
    if(value!==next[field])return false;
  }
  return true;
}