import Link from "next/link";
import {dirname} from "node:path";
import {redirect} from "next/navigation";
import {syncFeishu,syncStatus} from "@/studio/feishu";
import {prepareRehearsal,rehearsalState,restoreRehearsal} from "@/studio/restore-rehearsal";

export default async function Settings({searchParams}:{searchParams:Promise<{run?:string;notice?:string}>}){
  const {run,notice}=await searchParams,source=syncStatus();
  const rehearsal=run?await rehearsalState(run).catch(()=>null):null;
  const demo=process.env.STUDIO_DEMO_INSTANCE==="1";
  const configured=!demo&&Boolean(source.permissions?.store&&source.canSync);
  const revoked=!demo&&Boolean(source.permissions&&!source.permissions.store);
  const sourceState=configured?(source.reason?"同步异常":source.success?"已同步":"已配置 · 待同步"):"未连接";
  const database=process.env.STUDIO_DB||"data/studio.sqlite";
  const dataDir=dirname(database).replaceAll("\\","/");
  return <main className="dashboard"><header className="mast"><h1>工具与设置</h1></header>
    <section className="surface business-sources" id="sources" aria-labelledby="business-source-heading">
    <h2 id="business-source-heading">飞书资料库 · {sourceState}</h2>
    <p>可从获授权的飞书表导入写法参考，活动、产品等业务事实请查阅原始记录。</p>
    {configured&&<><p>授权用途：{Object.entries(source.permissions??{}).filter(([,on])=>on).map(([k])=>({store:"本地保存",create:"创作参考",evaluate:"评测",external:"外发许可"}[k])).join("、")}。</p>
    {source.success&&<p>上次成功同步 <time dateTime={source.success}>{new Date(source.success).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false})}</time></p>}
    {source.reason&&<p role="status">{source.reason}。请管理员检查只读权限、字段和网络，再点「按授权同步」。</p>}</>}
    {!configured&&!revoked&&source.label!=="未配置"&&!demo&&<p role="status">{source.label}。请管理员按接入步骤核对配置。</p>}
    {revoked&&<p>飞书保存授权已撤销，可以清理已保存在本机的内容。</p>}
    <details><summary>查看接入步骤</summary>
      <ol><li>请资料所有者确认哪些内容可同步，以及允许在哪些场景使用。</li><li>请管理员为对应飞书表配置只读访问，重启工作台。</li><li>回到这里确认授权范围，再点「按授权同步」。</li></ol>
      {demo&&<p>隔离演练实例停用了真实同步。</p>}
      <details><summary>管理员配置详情</summary><p><code>STUDIO_FEISHU_SCOPE</code> 填写应用与表标识（<code>app</code>、<code>table</code>）、标题、写法与更新时间的字段映射（<code>fields.title</code>、<code>fields.method</code>、<code>fields.updated</code>），以及保存、创作参考、评测、外发许可（<code>permissions.store</code>、<code>permissions.create</code>、<code>permissions.evaluate</code>、<code>permissions.external</code>）。在启动环境中设置只读凭证 <code>STUDIO_FEISHU_TOKEN</code>，然后重启。</p></details>
    </details>
    {(configured||revoked)&&<form action={async()=>{"use server";if(process.env.STUDIO_DEMO_INSTANCE==="1"||!syncStatus().canSync)return;try{await syncFeishu(JSON.parse(process.env.STUDIO_FEISHU_SCOPE!),process.env.STUDIO_FEISHU_TOKEN??"");}catch{}redirect("/studio/settings#sources");}}><button>{revoked?"应用撤权清理":"按授权同步"}</button></form>}</section>
    <section className="surface"><h2>日常配置</h2><ul>
      <li><Link href="/production/accounts">账号管理</Link></li>
      <li><Link href="/production/rules">写作规范</Link></li>
      <li><Link href="/production/standards">质量标准</Link></li>
      <li><Link href="/studio/settings/feishu-cards">飞书通知设置与卡片预览</Link></li>
      <li><Link href="/studio/settings/autopilot">模拟夜间巡航与飞书早报预览</Link></li>
      <li><Link href="/studio/settings/calibration">发布复盘与规则校准</Link></li>
      <li><Link href="/studio/settings/matrix">矩阵与装配记录</Link></li>
    </ul></section>
    <section className="surface"><h2>数据与备份</h2><ul>
      <li><a href="#backup">备份与恢复</a></li>
    </ul></section>
    <section className="surface"><h2>开发与诊断</h2><ul>
      <li><Link href="/studio/settings/doctor">System Doctor</Link></li>
      <li><Link href="/studio/settings/governance">治理效果对比</Link></li>
      <li><Link href="/quality">质量检查、模型实验与诊断</Link></li>
      <li><Link href="/acceptance">验收报告</Link></li><li><Link href="/examples">验收示例</Link></li>
      <li><Link href="/practice">离线写作练习</Link></li>
    </ul></section>
    <section className="surface" id="backup"><h2>备份与恢复</h2><p>可先用临时样本演练，再备份自己的任务与文章、参考库、调用回执、实验库及知识和向量索引。</p>
    <details><summary>备份自己的工作台</summary><ol><li>关闭工作台及写入程序，确认没有在途请求。选择私人目录下尚不存在的目标。</li><li>从项目目录运行预检，通过后备份。</li><li>恢复到另一个新目录，核对文章和版本，再手动决定是否切换。保留原目录。</li></ol>
    <p>当前文章与队列库为 <code>{database}</code>。账号、规范、批次、附件及图片版本同库保存。单独配置到标准目录之外的数据库需另行备份。</p>
    <pre>{[`node scripts/archive-workbench.mjs check-backup "${dataDir}" "D:/private/backup"`,`node scripts/archive-workbench.mjs backup "${dataDir}" "D:/private/backup"`,"node scripts/archive-workbench.mjs check-restore D:/private/backup D:/private/restored","node scripts/archive-workbench.mjs restore D:/private/backup D:/private/restored"].join("\n")}</pre></details>
    <h3>用临时样本演练</h3><p>仅创建虚构校样和空索引。先检查停写锁、文件覆盖、SQLite 完整性和目标目录，再用 SHA-256 校验备份。</p>
    <form action={async()=>{"use server";let id;try{id=await prepareRehearsal();}catch{redirect("/studio/settings?notice=prepare");}redirect("/studio/settings?run="+id);}}><button>创建样本备份并预检</button></form>
    {notice&&<p role="alert">操作未完成。检查临时目录的空间、写入锁和备份完整性，再新建演练。</p>}
    {run&&!rehearsal&&<p role="alert">找不到该演练，请重新创建样本备份。</p>}
    {rehearsal&&<><p role="status">{rehearsal.done?"恢复完成 · 五个文件均已核对":"预检通过 · 五个文件，三个数据库，摘要匹配"}</p><p>演练目录：{rehearsal.root}。恢复目标为其中的 restored 新目录。</p>
    {!rehearsal.done&&<form action={async()=>{"use server";try{await restoreRehearsal(run!);}catch{redirect("/studio/settings?notice=restore&run="+run);}redirect("/studio/settings?run="+run);}}><button>确认恢复到临时副本</button></form>}</>}
    </section></main>;
}
