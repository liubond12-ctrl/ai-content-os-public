import {DatabaseSync} from "node:sqlite";
import {randomInt,createHash} from "node:crypto";
import {redirect} from "next/navigation";
import cases from "../../../../docs/evidence/workbench/paired-flow.json";
export const dynamic="force-dynamic";
export default async function Compare({searchParams}:{searchParams:Promise<{saved?:string}>}){
 const saved=(await searchParams).saved==="1";
 // Request-local start time measures the elapsed interval until this form is submitted.
 // eslint-disable-next-line react-hooks/purity
 const swap=randomInt(2),start=Date.now(),pair=swap?[cases[1],cases[0]]:cases;
 const signature=createHash("sha256").update(JSON.stringify(cases)).digest("hex");
 return <main><h1>匿名比较成稿</h1><p>模拟批次 · 第 1 / 1 组。 一篇虚构初稿、相同资料，两种模拟生产流程。请只依据呈现的文字判断；两份相同可以选无差异。</p>
 {saved?<p role="status">个人偏好已记录，与人工确认的评测基准 分开保存。</p>:<form action={async(form)=>{"use server";const choice=form.get("choice");if(!["A","B","same","unsure"].includes(String(choice)))return;
 const db=new DatabaseSync(process.env.STUDIO_LIBRARY_DB??"data/content-library.sqlite");
 try{db.exec("CREATE TABLE IF NOT EXISTS preference_results(batch TEXT,ordering INTEGER,choice TEXT,reason TEXT,elapsed_ms INTEGER,at TEXT)");db.prepare("INSERT INTO preference_results VALUES(?,?,?,?,?,?)").run(signature,swap,String(choice),String(form.get("reason")??"").slice(0,1000),Date.now()-start,new Date().toISOString());}finally{db.close();}
 redirect("/acceptance/compare?saved=1");}}>
 {pair.map((c,i)=><section key={i}><h2>成稿 {i?"B":"A"}</h2><p>{c.finalText}</p></section>)}
 <label>你的判断<select name="choice" defaultValue="" required><option value="" disabled>请选择</option><option value="same">无差异</option><option value="A">更喜欢 A</option><option value="B">更喜欢 B</option><option value="unsure">不确定</option></select></label><label>理由<textarea name="reason"/></label><button>保存人工选择</button></form>}</main>;
}
