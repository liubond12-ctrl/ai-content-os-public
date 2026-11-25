import {DatabaseSync,backup} from "node:sqlite";
import {mkdir,readFile,writeFile,copyFile,rename,stat} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {createHash,randomUUID} from "node:crypto";

const [mode,source,destination]=process.argv.slice(2);
if(!["backup","restore","check-backup","check-restore"].includes(mode)||!source||!destination)throw Error("用法：node scripts/archive-workbench.mjs backup|restore 来源目录 新目录");
const files=["studio.sqlite","content-library.sqlite","experiments/lamp-deepseek-once.sqlite","knowledge.json","vectors.json"];
const target=resolve(destination),stage=target+".partial-"+randomUUID();
if(await stat(target).catch(()=>null))throw Error("目标目录必须不存在，避免覆盖现有资产");
const restoring=mode.endsWith("restore"),checking=mode.startsWith("check-");
const locks=[];
const hash=async path=>createHash("sha256").update(await readFile(path)).digest("hex");
try{
  if(!checking)await mkdir(stage,{recursive:true});
  const manifest=restoring?JSON.parse(await readFile(resolve(source,"manifest.json"),"utf8")):{};
  for(const name of files){
    const file=resolve(source,name);
    if(!(await stat(file)).isFile())throw Error("缺少覆盖文件 "+name);
    if(restoring && await hash(file)!==manifest[name])throw Error("备份校验失败 "+name);
    if(name.endsWith(".sqlite")){
      const db=new DatabaseSync(file,{readOnly:restoring});locks.push(db);
      if(!restoring){try{db.exec("BEGIN IMMEDIATE");}catch{throw Error("数据库仍有写入，请停止写入程序后重试");}}
      if(db.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")throw Error("数据库完整性校验失败 "+name);
    }
  }
  if(checking){console.log("预检通过：5 个文件、3 个数据库完整，目标目录尚不存在"+(restoring?"，清单摘要匹配":"，所有数据库均可取得停写锁"));}else{

  for(const name of files){
    const from=resolve(source,name),to=resolve(stage,name);
    await mkdir(dirname(to),{recursive:true});
    if(!restoring&&name.endsWith(".sqlite")){
      const reader=new DatabaseSync(from,{readOnly:true});try{await backup(reader,to);}finally{reader.close();}
    }
    else await copyFile(from,to);
    const digest=await hash(to);
    if(mode==="restore"&&digest!==manifest[name])throw Error("备份校验失败 "+name);
    manifest[name]=digest;
    if(name.endsWith(".sqlite")){
      const db=new DatabaseSync(to,{readOnly:true});
      try{if(db.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")throw Error("SQLite 完整性校验失败");}finally{db.close();}
    }
  }
  if(mode==="backup")await writeFile(resolve(stage,"manifest.json"),JSON.stringify(manifest,null,2));
  await rename(stage,target);console.log(mode+" 完成 "+target);}
}finally{for(const db of locks)db.close();}

