"use client";

import Link from "next/link";
import {useAppearance} from "./AppearanceProvider";
import CockpitOcean from "./CockpitOcean";
import "./display-settings.css";

export function DisplaySettings(){
  const {preferences,theme,ready,update}=useAppearance();
  const {visible,paused,strength}=preferences;
  return <main className="dashboard display-settings">
    <header className="mast"><Link href="/studio/system">返回系统机房</Link><h1>显示设置</h1></header>
    <section className="surface">
      <fieldset disabled={!ready}>
        <legend>外观</legend>
        <label>主题<select value={preferences.theme} onChange={event=>{
          const value=event.target.value;
          if(value==="system"||value==="light"||value==="dark")update({theme:value});
        }}>
          <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
        </select></label>
      </fieldset>
      <fieldset disabled={!ready}>
        <legend>首页背景</legend>
        <label><input type="checkbox" checked={visible} onChange={event=>update({visible:event.target.checked})}/> 显示背景海洋</label>
        <label><input type="checkbox" checked={paused} onChange={event=>update({paused:event.target.checked})}/> 静态阅读模式</label>
        <label className="appearance-strength">背景强度 <output>{Math.round(strength*100)}%</output>
          <input type="range" min=".25" max="1" step=".05" value={strength} onChange={event=>update({strength:event.target.valueAsNumber})}/>
        </label>
      </fieldset>
      <div className="appearance-preview">
        <CockpitOcean visible={visible} paused={paused} strength={strength} theme={theme} preview/>
        <h2>首页预览</h2>
        <p>{visible?(paused?"静态背景":"背景已开启"):"背景已关闭"}</p>
      </div>
      <p className="appearance-narrow-note">窄屏首页会停用背景，预览仍可查看。</p>
    </section>
  </main>;
}
