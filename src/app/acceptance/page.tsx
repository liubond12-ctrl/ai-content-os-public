import Link from "next/link";
import {readFileSync} from "node:fs";
export const dynamic="force-dynamic";
const file=(key:string,label:string)=><a href={"/acceptance/file?name="+key}>{label}</a>;
export default function Acceptance(){
 const sample=JSON.parse(readFileSync("docs/evidence/workbench/normal.json","utf8"));
 const tests=readFileSync("docs/evidence/workbench/regression.txt","utf8").match(/Tests\s+(\d+) passed \((\d+)\)/);
 return <main className="app-shell"><Link href="/">← 工作台</Link><h1>V1 工作台验收结论</h1>
 <p>从首页选资料、研究写作、处理指定原句、编辑定稿、刷新找回，到下载版本一致的正文，已由 Edge 实际完成。研究、写作与审核响应来自隔离模拟服务。{file("browser","普通入口记录")}</p>
 <p><Link href="/examples?case=final">《{sample.title}》· 定稿 v{sample.version}</Link> · {file("article","下载已核对的 Markdown")}</p>
 <table><thead><tr><th>任务</th><th>验收结果及证据</th></tr></thead><tbody>
 <tr><th>01 范围</th><td>保留开工基线与收尾结论。{file("matrix","逐项对照")}</td></tr>
 <tr><th>02 模型与定位</th><td>历史真实策略响应的三条建议均能确定原文位置。新增真实请求为零；无真实全链路质量结论。{file("replay","Promptfoo 回放")}</td></tr>
 <tr><th>03 逐句协作</th><td>无分歧、实质冲突、事实缺口三个隔离案例已实际打开。冲突卡片可追溯双方意见、回应、裁决、原句与修订版本。{file("checks","浏览器记录")}</td></tr>
 <tr><th>04 人工决定</th><td>可在文章旁保留、删除或自改并预览。Edge 仅删去第二处重复；Ego 在《灯还亮着》保留结尾并记下理由，恢复历史再定稿，下载与正文一致。</td></tr>
 <tr><th>05 评测</th><td>固定初稿的单审核与多角色模拟流程各完成 1/1；分别 3 次与 5 次请求，两份修订相同。表达开关比较覆盖 2 篇 × 2 种设置。真实质量、误伤与偏好缺人工确认，十例仍为候选。{file("paired","流程成本")} · {file("style","规则开关")} · <Link href="/acceptance/compare">匿名比较</Link></td></tr>
 <tr><th>06 资料</th><td>方法收藏经确认后可检索。飞书更新、撤权、发送前拒绝和历史清理在临时库通过。真实飞书表待授权，手动同步间隔内不能即时获知远端变化。</td></tr>
 <tr><th>07 恢复与费用</th><td>在恢复实例从首页找到定稿并重新下载核对。停止、未知结果不重发；重复调度、预算不足、超时与回执保留有自动测试。实扣无账单来源。{file("restore","逐表核对")}</td></tr>
 <tr><th>08 使用体验</th><td>首页分开创作与示例，文章显示版本、保存状态与定稿主操作。390px 首页和键盘提交已检查。{tests?tests[1]+"/"+tests[2]+" 项回归通过。":""}{file("tests","回归日志")}</td></tr>
 </tbody></table>
 <h2>待授权或人工确认</h2><p>普通业务资料外发、独立付费协作复验、真实批量对照和真实飞书读取均未执行。线上质量、实际成本、严重问题漏放率与风格规则收益没有有效人工分母。真实云端专业审核和批量入口当前关闭。{file("scope","具体数据、各角色提示词、建议预算与停止条件")}</p>
 <details><summary>启动及复验</summary><p>在仓库根目录执行 <code>npm.cmd run build</code> 后执行 <code>npm.cmd run start -- -H 127.0.0.1 -p 3288</code>。普通创作验收与三种协作场景的复现脚本分别为 verify-normal-workbench.mjs 和 verify-completion.mjs。{file("notes","分阶段开发记录")}</p></details></main>;
}
