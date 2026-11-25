import { assembleContext } from "@/context";
import Link from 'next/link';
import { Workbench } from "@/components/Workbench";
import { demoScenarios } from "@/components/scenarios";

export default async function Home() {
  const initialResult = await assembleContext(demoScenarios[0].input);
  return <><nav style={{padding:16}}><Link href="/studio">AI 内容工作台</Link> · <Link href="/rag">Phase 2 · 知识检索</Link></nav><Workbench initialResult={initialResult} /></>;
}
