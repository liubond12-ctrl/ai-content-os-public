"use client";
import Link,{useLinkStatus} from "next/link";
import {usePathname} from "next/navigation";
import {useRef,useState} from "react";
import {rememberArticleEntry} from "./RestoreArticlePosition";
import {Icon} from "./WorkspaceIcon";
import type {CreatorArea,CreatorPrimaryArea,CreatorSection,CreatorShortcut} from "@/types/creator-workspace";

const sections:CreatorSection[]=[
  {id:"today",href:"/",label:"今日待办",icon:"home"},
  {id:"writing",href:"/production/create",label:"写稿与精修",icon:"doc"},
  {id:"history",href:"/articles",label:"历史文章",icon:"book"},
  {id:"discovery",href:"/hot",label:"热点与巡航",icon:"hot"},
  {id:"materials",href:"/studio/settings",label:"账号与素材",icon:"book"},
];
const shortcuts:Partial<Record<CreatorPrimaryArea,CreatorShortcut[]>>={
  history:[
    {href:"/articles",label:"全部文章"},{href:"/articles?status=需求草稿",label:"需求草稿"},
    {href:"/production/tasks",label:"任务与搜索"},{href:"/production/queue",label:"历史批次与队列"},
  ],
  discovery:[
    {href:"/hot",label:"今日热点"},{href:"/studio/settings/autopilot#cruise-results",label:"查看巡航筛选结果"},
  ],
  materials:[
    {href:"/production/accounts",label:"管理账号"},{href:"/studio/cases",label:"查看写作素材"},
    {href:"/production/rules",label:"编辑写作规范"},{href:"/studio/settings/calibration",label:"发布复盘"},
  ],
};
const systemPaths=["/quality","/practice","/acceptance","/examples","/rag","/rules","/studio/experiment",
  "/studio/settings/doctor","/studio/settings/governance","/studio/settings/matrix","/studio/settings/feishu-cards","/studio/system"];

function areaFor(path:string):CreatorArea {
  if(path==="/")return "today";
  if(systemPaths.some(base=>path===base||path.startsWith(base+"/")))return "system";
  if(path==="/hot"||path==="/studio/settings/autopilot")return "discovery";
  if(["/articles","/production/tasks","/production/queue"].includes(path))return "history";
  if(path.startsWith("/studio/settings")||["/studio/cases","/production/accounts","/production/rules","/production/standards"].includes(path))return "materials";
  return "writing";
}
function NavigationFeedback(){
  const {pending}=useLinkStatus();
  return pending?<span className="rail-pending" aria-hidden="true"/>:null;
}
export default function Workspace({children,demo,real=false}:{children:React.ReactNode;demo:boolean;real?:boolean}){
  const path=usePathname(),area=areaFor(path),active=sections.find(section=>section.id===area);
  const [expanded,setExpanded]=useState(false);
  const toggle=useRef<HTMLButtonElement>(null);
  const nearby=area==="history"||area==="discovery"?shortcuts[area]:path==="/studio/settings"?shortcuts.materials:undefined;
  const sectionLabel=active?.label??"系统机房";
  function closeMenu(){setExpanded(false);}
  function followMenu(){
    if(!expanded)return;
    closeMenu();
    toggle.current?.focus({preventScroll:true});
  }
  return <div className="desk" onClickCapture={rememberArticleEntry} onKeyDownCapture={event=>{
    if(event.key==="Enter"&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229))event.preventDefault();
  }}>
    <aside className="rail creator-rail" onKeyDown={event=>{
      if(event.key==="Escape"&&expanded){event.preventDefault();closeMenu();toggle.current?.focus();}
    }}>
      <div className="creator-rail-heading"><div className="brand"><span aria-hidden="true">✎</span> AI Content OS</div>
        <button className="creator-menu-toggle" type="button" ref={toggle} aria-label="工作空间菜单" aria-expanded={expanded}
          aria-controls="creator-rail-links" onClick={()=>setExpanded(open=>!open)}>{sectionLabel} <span aria-hidden="true">{expanded?"▴":"▾"}</span></button>
      </div>
      <div className="creator-rail-links" id="creator-rail-links" data-expanded={expanded}>
        <nav aria-label="工作空间">{sections.map(section=><Link key={section.href} href={section.href} onNavigate={followMenu}
          aria-current={section===active?(path===section.href?"page":"location"):undefined}>
          <Icon type={section.icon}/>{section.label}<NavigationFeedback/></Link>)}</nav>
        <nav className="creator-rail-system" aria-label="设置与体检">
          <Link className="creator-system-link" href="/studio/system" onNavigate={followMenu}
            aria-current={area==="system"?(path==="/studio/system"?"page":"location"):undefined}>
            <Icon type="settings"/>系统机房<NavigationFeedback/></Link><span className="creator-system-caption">设置与体检</span></nav>
      </div>
    </aside>
    <div className="content"><div className="creator-topbar"><div className="crumb">{demo?"离线演练":real?"真实 API 验收":"个人空间"}{" / "+sectionLabel}</div></div>
      {nearby&&<nav className="creator-shortcuts" aria-label={sectionLabel}>{nearby.map(item=><Link key={item.href} href={item.href}>{item.label}<NavigationFeedback/></Link>)}</nav>}
      {children}</div>
  </div>;
}
