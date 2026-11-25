import Link from "next/link";
import {readFile} from "node:fs/promises";
import final from "../../../docs/evidence/workbench/normal.json";

// Curated excerpts of the three isolated runs in phase3.5-professional-tests.json.
const cases = [
  {id:"final", title:"已定稿", detail:"阅读《最后一张校样》，下载同一版本的正文。"},
  {id:"agreement", title:"无分歧", detail:"查看两位审核者为什么都同意通过。"},
  {id:"conflict", title:"有分歧", detail:"同一句话应该保留还是删除？对照意见与修订稿。"},
  {id:"facts", title:"事实待核实", detail:"查看哪项日期缺少来源，以及审核停在哪里。"},
];

export default async function Examples({searchParams}:{searchParams:Promise<{case?:string}>}) {
  const id=(await searchParams).case;
  const item=cases.find(entry=>entry.id===id);
  return <main className="dashboard">
    <header className="mast"><p>本地模拟记录 · 只读历史回放</p>
      <h1>{item?.title??(id?"示例链接无效":"验收示例")}</h1>
    </header>
    {id?<Link href="/examples">← 返回验收示例列表</Link>:<p>以下四份记录独立于个人文章，刷新后可再次查看。</p>}
    {!id&&<div className="list">{cases.map(entry=><article key={entry.id}><div className="item">
      <Link href={"/examples?case="+entry.id}>{entry.title}</Link><p>{entry.detail}</p>
    </div></article>)}</div>}
    {id&&!item&&<p>列表中没有这个示例，请从列表重新选择。</p>}
    {id==="final"&&<section><h2>《{final.title}》 · v{final.version}</h2>
      <p data-article-body style={{whiteSpace:"pre-wrap"}}>{await readFile("docs/evidence/workbench/最后一张校样.md","utf8")}</p>
      <a href="/acceptance/file?name=article" download>下载 v{final.version} 正文（Markdown）</a>
    </section>}
    {id==="agreement"&&<section><h2>v3 · 跳过讨论</h2><p>内容策略审核通过，认为文章回应了虚构故事的要求；语言审核也通过，没有标出需要修改的句子。</p>
      <p>两方都没有提出修改意见，因此没有相互冲突的建议。系统跳过讨论，进入待人工确认。</p></section>}
    {id==="conflict"&&<section><h2>v3 · 两方都标出了第二句</h2>
      <blockquote>虚构故事：小舟停在岸边。<mark>小舟停在岸边。</mark></blockquote>
      <dl><dt>内容策略 · 保留</dt><dd>重复形成节奏，建议保留。</dd>
      <dt>语言审核 · 删除</dt><dd>同句重复，建议删除第二句。</dd>
      <dt>裁决 · 采纳语言意见</dt><dd>用户需要精简，删除无信息重复。</dd></dl>
      <h2>v4 · 删除第二句后的正文</h2><blockquote>虚构故事：小舟停在岸边。</blockquote>
      <p>修订稿复审通过，进入待人工确认。</p></section>}
    {id==="facts"&&<section><h2>v3 · 报名日期缺少依据</h2><blockquote>考试报名日期为2027年5月1日</blockquote>
      <p>事实审核把这一日期标为关键断言。记录没有关联来源，也没有外部核验结果。需要能对应这场考试、明确写出报名日期的公告。</p>
      <h2>停止原因</h2><p>关键日期仍待核验，裁决者无权解除事实阻断。流程停在人工核实阶段。</p></section>}
  </main>;
}
