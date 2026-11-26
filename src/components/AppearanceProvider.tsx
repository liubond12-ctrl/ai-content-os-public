"use client";

import {createContext,useContext,useEffect,useState,type ReactNode} from "react";
import {appearanceKey,defaultAppearance,readAppearance} from "@/studio/workbench-appearance";
import type {ResolvedWorkbenchTheme,WorkbenchAppearance} from "@/types/creator-workspace";

const AppearanceContext=createContext<{
  preferences:WorkbenchAppearance;
  theme:ResolvedWorkbenchTheme;
  ready:boolean;
  update:(changes:Partial<WorkbenchAppearance>)=>void;
}|null>(null);

export function AppearanceProvider({children}:{children:ReactNode}){
  const [saved,setSaved]=useState<WorkbenchAppearance|null>(null);
  const [systemDark,setSystemDark]=useState(false);
  const preferences=saved??defaultAppearance;
  const theme=preferences.theme==="system"?(systemDark?"dark":"light"):preferences.theme;

  useEffect(()=>{
    const media=matchMedia("(prefers-color-scheme: dark)");
    const syncTheme=()=>setSystemDark(media.matches);
    function syncStorage(){
      try{setSaved(readAppearance(localStorage.getItem(appearanceKey)));}
      catch{setSaved(defaultAppearance);}
    }
    function onStorage(event:StorageEvent){
      if(event.key===appearanceKey||event.key===null)syncStorage();
    }
    syncTheme();
    syncStorage();
    media.addEventListener("change",syncTheme);
    window.addEventListener("storage",onStorage);
    return ()=>{
      media.removeEventListener("change",syncTheme);
      window.removeEventListener("storage",onStorage);
    };
  },[]);

  useEffect(()=>{
    if(saved)document.documentElement.dataset.workbenchTheme=theme;
  },[saved,theme]);

  function update(changes:Partial<WorkbenchAppearance>){
    const next={...preferences,...changes};
    setSaved(next);
    try{localStorage.setItem(appearanceKey,JSON.stringify(next));}catch{}
  }

  return <AppearanceContext.Provider value={{preferences,theme,ready:saved!==null,update}}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(){
  const appearance=useContext(AppearanceContext);
  if(!appearance)throw Error("显示设置需在工作台内使用");
  return appearance;
}
