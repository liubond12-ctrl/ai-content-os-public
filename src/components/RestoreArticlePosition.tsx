"use client";
import {useEffect} from "react";

const storageKey=(url:URL)=>"article-position:"+url.pathname+url.search+url.hash;
export function rememberArticleEntry(event:React.MouseEvent){
  if(!(event.target instanceof Element)||event.button!==0)return;
  const link=event.target.closest<HTMLAnchorElement>("a[href]");
  if(!link)return;
  const destination=new URL(link.href);
  const origin=destination.searchParams.get("returnTo");
  if(!origin||destination.origin!==location.origin)return;
  const url=new URL(origin,location.origin);
  if(url.origin!==location.origin||url.pathname!==location.pathname)return;
  const target=url.hash&&document.getElementById(url.hash.slice(1));
  if(!target||!target.contains(link))return;
  try{
    const index=Array.from(target.querySelectorAll("a")).indexOf(link);
    const bounds=target.getBoundingClientRect();
    sessionStorage.setItem(storageKey(url),JSON.stringify({top:bounds.top,index}));
  }catch{}
}
export function RestoreArticlePosition({prefix,fallback}:{prefix:string;fallback:string}){
  useEffect(()=>{
    function restore(){
      const url=new URL(location.href),hash=url.hash.slice(1);
      if(!hash.startsWith(prefix))return;
      const original=document.getElementById(hash),target=original??document.getElementById(fallback);
      if(!target)return;
      let prior:{top?:number;index?:number}|null=null;
      try{prior=JSON.parse(sessionStorage.getItem(storageKey(url))??"null");}catch{}
      requestAnimationFrame(()=>{
        const links=target.querySelectorAll("a");
        const focusTarget=target.matches("a")?target:original?(links[prior?.index??0]??target):target;
        for(let details=focusTarget.closest("details");details;details=details.parentElement?.closest("details")??null)
          details.open=true;
        const top=prior?.top;
        if(original&&typeof top==="number"&&Number.isFinite(top)&&top+target.getBoundingClientRect().height>0&&top<innerHeight)
          window.scrollTo({top:window.scrollY+target.getBoundingClientRect().top-top,behavior:"instant"});
        else target.scrollIntoView({block:"start"});
        focusTarget.focus({preventScroll:true});
      });
    }
    restore();
    window.addEventListener("hashchange",restore);
    return()=>window.removeEventListener("hashchange",restore);
  },[prefix,fallback]);
  return null;
}
