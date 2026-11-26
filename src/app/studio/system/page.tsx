import Link from "next/link";

const tools=[
  {title:"显示设置",description:"调整主题和首页背景。",href:"/studio/system/display"},
  {title:"检查运行状态",description:"检查模型、资料检索和飞书是否可用。",href:"/studio/settings/doctor"},
  {title:"查看治理效果",description:"用离线样本比较事实核验、账号规范和各平台用词检查。",href:"/studio/settings/governance"},
  {title:"巡航费用与暂停上限",description:"查看当天估算费用、预算上限和暂停状态。",href:"/studio/system/cruise"},
  {title:"资料使用与同题记录",description:"查看稿件采用了哪些资料，以及同题成稿的差异。",href:"/studio/settings/matrix"},
  {title:"规则提案存档与模型分工",description:"查看拦截或已失效的提案，预演当前模型分工。",href:"/studio/system/rules"},
  {title:"飞书通知和卡片",description:"查看通知状态，预览或配置卡片。",href:"/studio/settings/feishu-cards"},
  {title:"备份与恢复",description:"查看本机备份步骤，或用临时样本演练恢复。",href:"/studio/settings#backup"},
];
export default function SystemRoom(){
  return <main className="dashboard creator-room"><header className="mast"><h1>系统机房</h1></header>
    <ul className="creator-tool-list">{tools.map(item=><li key={item.href}><Link href={item.href}>
      <strong>{item.title}</strong><span>{item.description}</span><span aria-hidden="true">→</span></Link></li>)}</ul>
    <details><summary>实验、验收与离线练习</summary><ul>
      <li><Link href="/quality">质量检查、模型实验与诊断</Link></li>
      <li><Link href="/acceptance">验收报告</Link></li><li><Link href="/examples">验收示例</Link></li>
      <li><Link href="/practice">离线写作练习</Link></li></ul></details>
  </main>;
}
