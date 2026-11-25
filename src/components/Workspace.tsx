"use client";
import Link,{useLinkStatus} from "next/link";
import {usePathname} from "next/navigation";
import {rememberArticleEntry} from "./RestoreArticlePosition";
import {Icon} from "./WorkspaceIcon";

const sections=[
  {href:"/",name:"首页",icon:"home"},
  {href:"/hot",name:"今日热点",icon:"hot"},
  {href:"/production/create",name:"新建内容",icon:"doc"},
  {href:"/articles",name:"我的内容",icon:"doc"},
  {href:"/studio/cases",name:"写作参考库",icon:"book"},
  {href:"/production/rules",name:"写作规范",icon:"book"},
  {href:"/studio/settings",name:"工具与设置",icon:"settings"},
] as const;
const childrenByPath:Record<string,[string,string]>={
  "/studio/settings/feishu-cards":["/studio/settings","飞书个人卡片"],
  "/production/tasks":["/","全部任务"],
  "/studio":["/production/create","内容进度"],
  "/production/free":["/production/create","自由文章"],
  "/production/accounts":["/studio/settings","账号常用设置"],
  "/production/standards":["/studio/settings","质量标准"],
  "/production/package":["/articles","配图与内容包"],
  "/production/queue":["/","执行队列"],
  "/studio/editor":["/articles","文章编辑器"],
  "/examples":["/studio/settings","验收示例"],
  "/quality":["/studio/settings","质量检查与诊断"],
  "/practice":["/studio/settings","离线写作练习"],
  "/quality/evaluation":["/studio/settings","人工评测"],
  "/acceptance/compare":["/studio/settings","匿名比较"],
  "/rag":["/studio/settings","知识检索"],
  "/rules":["/studio/settings","账号规则"],
  "/studio/experiment":["/studio/settings","真实协作实验"],
  "/acceptance":["/studio/settings","工作台验收"],
};
function NavigationFeedback(){
  const {pending}=useLinkStatus();
  return pending?<span className="rail-pending" aria-hidden="true"/>:null;
}
export default function Workspace({children,demo,real=false}:{children:React.ReactNode;demo:boolean;real?:boolean}){
  const path=usePathname();
  const sub=childrenByPath[path];
  const active=sections.find(s=>s.href===(sub?.[0]??path));
  return <div className="desk" onClickCapture={rememberArticleEntry} onKeyDownCapture={e=>{
    if(e.key==="Enter"&&(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229))e.preventDefault();
  }}><aside className="rail"><div className="brand"><span aria-hidden="true">✎</span> AI Content OS</div>
    <nav aria-label="工作空间">{sections.map(s=><Link key={s.href} href={s.href} aria-current={s===active?(sub?"location":"page"):undefined}><Icon type={s.icon}/>{s.name}<NavigationFeedback/></Link>)}</nav></aside>
    <div className="content"><div className="crumb">{real?"隔离验收实例 · 真实 API":demo?"隔离验收实例 · 模拟数据":"个人空间"}　/　{active?.name}{sub&&"　/　"+sub[1]}</div>{children}</div>
  </div>;
}
