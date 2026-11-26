import type {WorkbenchAppearance} from "@/types/creator-workspace";

export const appearanceKey="workbench-appearance";
export const defaultAppearance:WorkbenchAppearance={theme:"system",visible:false,paused:false,strength:.4};

export function readAppearance(raw:string|null):WorkbenchAppearance {
  try{
    const value=JSON.parse(raw??"null");
    if(!value||typeof value!=="object")return defaultAppearance;
    return {
      theme:value.theme==="dark"||value.theme==="light"?value.theme:"system",
      visible:value.visible===true,
      paused:value.paused===true,
      strength:typeof value.strength==="number"&&value.strength>=.25&&value.strength<=1?value.strength:defaultAppearance.strength,
    };
  }catch{return defaultAppearance;}
}

// Resolve the saved theme before the first render. Only fixed palette names reach the DOM.
export const appearanceBootstrap=`(()=>{let mode;try{mode=JSON.parse(localStorage.getItem(${JSON.stringify(appearanceKey)})||"null")?.theme}catch{}document.documentElement.dataset.workbenchTheme=mode==="light"||mode==="dark"?mode:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"})()`;
