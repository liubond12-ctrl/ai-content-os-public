import {DatabaseSync} from "node:sqlite";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdir,writeFile,access} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";

const archive=promisify(execFile);
function folder(id:string){
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))throw Error("演练编号无效");
  return join(tmpdir(),"workbench-rehearsal-"+id);
}
async function run(mode:string,source:string,target:string){
  await archive(process.execPath,["scripts/archive-workbench.mjs",mode,source,target],{timeout:30000,windowsHide:true});
}
export async function prepareRehearsal(){
  const id=randomUUID(),root=folder(id),source=join(root,"sample"),backup=join(root,"backup");
  await mkdir(root);await mkdir(join(source,"experiments"),{recursive:true});
  for(const name of ["studio.sqlite","content-library.sqlite","experiments/lamp-deepseek-once.sqlite"]){
    const d=new DatabaseSync(join(source,name));
    try{d.exec("CREATE TABLE rehearsal(note TEXT);INSERT INTO rehearsal VALUES('虚构校样')");}finally{d.close();}
  }
  for(const name of ["knowledge.json","vectors.json"])await writeFile(join(source,name),"[]");
  await run("check-backup",source,backup);
  await run("backup",source,backup);
  await run("check-restore",backup,join(root,"restored"));
  return id;
}
export async function rehearsalState(id:string){
  const root=folder(id);
  await access(join(root,"backup","manifest.json"));
  const done=await access(join(root,"restored","studio.sqlite")).then(()=>true,()=>false);
  return {root,done};
}
export async function restoreRehearsal(id:string){
  const {root}=await rehearsalState(id);
  await run("restore",join(root,"backup"),join(root,"restored"));
}
