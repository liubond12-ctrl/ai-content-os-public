"use client";
import Link,{useLinkStatus} from "next/link";
import {usePathname} from "next/navigation";
import {rememberArticleEntry} from "./RestoreArticlePosition";
import {Icon} from "./WorkspaceIcon";

import type {CreatorArea,CreatorSection,CreatorShortcut} from "@/types/creator-workspace";

const sections:CreatorSection[]=[
  {id:"today",href:"/",label:"今日待办",icon:"home"},
  {id:"writing",href:"/articles",label:"写稿与精修",icon:"doc"},
  {id:"materials",href:"/studio/settings",label:"账号与素材",icon:"book"},
];
const writing:CreatorShortcut[]=[
  {href:"/production/create",label:"新建稿件"},{href:"/hot",label:"参考今日热点"},
  {href:"/articles",label:"找稿和精修"},{href:"/production/queue",label:"查看进度"},
];
const materials:CreatorShortcut[]=[
  {href:"/production/accounts",label:"管理账号"},{href:"/studio/cases",label:"查看写作素材"},
  {href:"/production/rules",label:"编辑写作规范"},{href:"/studio/settings/calibration",label:"发布复盘"},
];
const systemPaths=new Set(["/quality","/practice","/acceptance","/examples","/rag","/rules","/studio/experiment",
  "/studio/settings/doctor","/studio/settings/governance","/studio/settings/autopilot","/studio/settings/matrix","/studio/system"]);
function areaFor(path:string):CreatorArea {
  if(path==="/")return "today";
  if([...systemPaths].some(base=>path===base||path.startsWith(base+"/")))return "system";
  if(path.startsWith("/studio/settings")||["/studio/cases","/production/accounts","/production/rules","/production/standards"].includes(path))return "materials";
  return "writing";
}
function NavigationFeedback(){
  const {pending}=useLinkStatus();
  return pending?<span className="rail-pending" aria-hidden="true"/>:null;
}
export default function Workspace({children,demo,real=false}:{children:React.ReactNode;demo:boolean;real?:boolean}){
  const path=usePathname();
  const area=areaFor(path),active=sections.find(s=>s.id===area);
  const shortcuts=path==="/articles"?writing:path==="/studio/settings"?materials:[];
  return <div className="desk" onClickCapture={rememberArticleEntry} onKeyDownCapture={e=>{
    if(e.key==="Enter"&&(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229))e.preventDefault();
  }}><aside className="rail"><div className="brand"><span aria-hidden="true">✎</span> AI Content OS</div>
    <nav aria-label="工作空间">{sections.map(s=><Link key={s.href} href={s.href} aria-current={s===active?(path===s.href?"page":"location"):undefined}><Icon type={s.icon}/>{s.label}<NavigationFeedback/></Link>)}</nav></aside>
    <div className="content"><div className="creator-topbar"><div className="crumb">{demo?"离线演练":real?"真实 API 验收":"个人空间"}{active&&" / "+active.label}</div>
      <Link className="creator-system-link" href="/studio/system" aria-current={area==="system"?(path==="/studio/system"?"page":"location"):undefined}><Icon type="settings"/>系统机房<NavigationFeedback/></Link></div>
      {shortcuts.length>0&&<nav className="creator-shortcuts" aria-label={active?.label}>{shortcuts.map(item=><Link key={item.href} href={item.href} aria-current={path===item.href?"page":undefined}>{item.label}<NavigationFeedback/></Link>)}</nav>}
      {children}</div>
  </div>;
}
