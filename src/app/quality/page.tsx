import Link from "next/link";
const tools=[
  ["/production/standards","质量标准","管理业务判断维度与版本；评测基准需人工确认。"],
  ["/quality/evaluation","人工评测","核对候选样本与原文，保存人工判断。"],
  ["/acceptance/compare","匿名比较","阅读同一初稿的两份成稿，再选择偏好。"],
  ["/studio/experiment","模型实验","查看独立实验的执行状态、请求回执与费用估算。"],
  ["/rules","规则诊断","查看历史账号的规则装配与冲突。"],
  ["/rag","检索诊断","查看历史账号检索命中的片段与来源。"],
  ["/acceptance","验收报告","查看已完成的验证与技术记录。"],
];
export default function Page(){return <main className="dashboard"><header className="mast"><h1>质量检查与诊断</h1></header><div className="list">{tools.map(([href,title,detail])=><article key={href}><div><Link href={href}>{title}</Link><p>{detail}</p></div></article>)}</div></main>;}
