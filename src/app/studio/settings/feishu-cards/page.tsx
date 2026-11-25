import "./cards.css";
import Link from "next/link";
import {revalidatePath} from "next/cache";
import {cardDb,prefs,savePrefs,versionLabel,type Card,type Mode} from "@/studio/feishu-cards";
import examples from "@/studio/feishu-card-examples.json";
export const dynamic="force-dynamic";
const labels={batch:"批次汇总",blocked:"受阻提醒",choice:"主观取舍"};
function Preview({card,result}:{card:Card;result?:string}){
  return <article className="fs-preview"><div className={"fs-band fs-"+card.kind}>{labels[card.kind]}</div><h3>{card.title}</h3><p className="fs-copy">{card.text}</p>{card.task&&<p className="meta">{versionLabel(card)}</p>}
  {result&&<p>{result}</p>}{<div className="fs-options">{(result?(result.startsWith("已记录稍后")&&card.kind==="choice"?card.options.filter(a=>a!=="later"):[]):card.options).map(a=><span key={a}>{a==="later"?"稍后处理":"采用方案 "+a}</span>)}</div>}<p className="meta">请在电脑工作台查看正文与执行记录。</p></article>;
}
export default function Page(){
  const mode:Mode=process.env.FEISHU_CARD_LIVE_APPROVED==="1"?"live":"mock",db=cardDb();
  let settings,rows;
  try{settings=prefs(db,mode);rows=db.prepare("SELECT card,result,delivery FROM fs_outbox WHERE mode=? ORDER BY rowid DESC LIMIT 15").all(mode);}finally{db.close();}
  const online=settings.online;
  async function update(f:FormData){"use server";savePrefs(mode,{batch:f.has("batch"),blocked:f.has("blocked"),choice:f.has("choice")});revalidatePath("/studio/settings/feishu-cards");}
  return <main className="production"><header className="production-head"><h1>飞书个人卡片</h1><Link href="/studio/settings">返回设置</Link></header>
  <section><h2>连接与通知</h2><p>{mode==="mock"?"本地模拟 · 真实消息发送关闭":"真实私聊模式"} · 通知进程{online?"在线":"未连接"} · 回调通道：{online?settings.link:"未连接"}</p><p>接收者：{mode==="mock"?"本地预览身份":process.env.FEISHU_CARD_OWNER||"尚未指定"}。资料表只读授权在上一级单独管理。</p>
  <form action={update}><fieldset><legend>通知类型</legend>{(Object.keys(labels) as (keyof typeof labels)[]).map(k=><label key={k}><input type="checkbox" name={k} defaultChecked={settings.enabled[k]}/>{labels[k]}</label>)}</fieldset><button>保存通知设置</button></form></section>
  <section><h2>最近通知</h2>{!rows.length&&<p>当前模式尚无投递记录。</p>}{rows.map((r,i)=><div key={i}><p>投递：{r.delivery==="sent"?"已投递":r.delivery==="unknown"?"结果未知，请人工核对":r.delivery==="expired"?"已过期":"等待投递"}</p><Preview card={JSON.parse(String(r.card))} result={String(r.result)}/></div>)}</section>
  <section><h2>隔离样例预览</h2><p>来自本地虚构批次，按钮展示手机端可选操作。</p><div className="fs-previews">{(examples as Card[]).map(c=><Preview key={c.kind} card={c}/>)}</div></section></main>;
}