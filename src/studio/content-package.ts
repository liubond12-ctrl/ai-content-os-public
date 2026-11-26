import {productionDb,event} from "./production-db";
import {readArticles,articleStateInTransaction} from "./article-store";
import {lookup} from "./tasks";
import {validateBody} from "./production-schema";
import {storyboardCards} from "./storyboard";

// ZIP store entries with UTF-8 names. No compression or third-party runtime.
function crc(data:Buffer){
  let value=0xffffffff;
  for(const byte of data){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}
  return (value^0xffffffff)>>>0;
}
export function zip(files:{name:string;data:Buffer}[]){
  const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
  for(const file of files){
    const name=Buffer.from(file.name),checksum=crc(file.data),header=Buffer.alloc(30),entry=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt32LE(checksum,14);header.writeUInt32LE(file.data.length,18);header.writeUInt32LE(file.data.length,22);header.writeUInt16LE(name.length,26);
    entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt32LE(checksum,16);entry.writeUInt32LE(file.data.length,20);entry.writeUInt32LE(file.data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
    local.push(header,name,file.data);central.push(entry,name);offset+=header.length+name.length+file.data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
export function imageState(id:string){
  const task=lookup(id),article=readArticles(id).head,db=productionDb();
  try{
    const images=db.prepare("SELECT i.*,a.name,a.mime FROM production_images i LEFT JOIN production_assets a ON a.id=i.asset WHERE task=? ORDER BY page,version DESC").all(id);
    const illustrations=db.prepare("SELECT a.id,a.name FROM production_assets a JOIN production_material_owners o ON o.asset=a.id WHERE o.draft=? AND a.mime LIKE 'image/%' ORDER BY a.created,a.id").all(id).map(a=>({id:String(a.id),name:String(a.name)}));
    const platform=task?.input.production?.platform||"小红书";
    return {task:task?.input.production,article,images,illustrations,cards:storyboardCards(id,article.version,article.title,article.body,platform)};
  }finally{db.close();}
}
export function bindImage(task:string,page:number,article:number,asset:string,confirmed:boolean,expected?:number){
  readArticles(task);
  const db=productionDb();
  try{
    db.exec("BEGIN IMMEDIATE");
    const row=db.prepare("SELECT a.mime FROM production_assets a LEFT JOIN production_material_owners o ON o.asset=a.id WHERE a.id=? AND a.brand='default' AND a.allowed=1 AND (o.asset IS NULL OR o.draft=?)").get(asset,task);
    if(!row||!String(row.mime).startsWith("image/")||!Number.isInteger(page)||page<1||page>100)throw Error("请选图片和有效页序");
    if(articleStateInTransaction(db,task).head.version!==article)throw Error("文字版本已变化，请重新确认配图");
    const version=Number(db.prepare("SELECT max(version) AS v FROM production_images WHERE task=? AND page=?").get(task,page)?.v??0)+1;
    if(expected!==undefined&&expected!==version-1)throw Error("图位已更新，请重新载入");
    db.prepare("INSERT INTO production_images VALUES(?,?,?,?,?,?,?)").run(crypto.randomUUID(),task,page,version,article,asset,confirmed?1:0);
    event(db,task,article,"配图"+page+"版本"+version,confirmed?"人工确认":"待确认");
    db.exec("COMMIT");
  }finally{db.close();}
}
export function clearImage(task:string,page:number,article:number,expected:number){
  readArticles(task);
  const db=productionDb();
  try{
    db.exec("BEGIN IMMEDIATE");
    if(articleStateInTransaction(db,task).head.version!==article)throw Error("文字版本已变化，请重新打开图位");
    const latest=db.prepare("SELECT version,asset FROM production_images WHERE task=? AND page=? ORDER BY version DESC LIMIT 1").get(task,page);
    if(!latest?.asset||latest.version!==expected)throw Error("图位已更新，请重新载入");
    db.prepare("INSERT INTO production_images VALUES(?,?,?,?,?,?,?)").run(crypto.randomUUID(),task,page,expected+1,article,null,0);
    event(db,task,article,"清空图位 "+page,"保留旧图片和版本");
    db.exec("COMMIT");
  }finally{db.close();}
}
export function exportPackage(id:string){
  const {task,article,images}=imageState(id);
  if(!article.confirmed)throw Error("请先确认文字定稿");
  const latest=[...new Map([...images].reverse().map(i=>[Number(i.page),i])).values()].filter(i=>i.asset!==null).sort((a,b)=>Number(a.page)-Number(b.page));
  if(latest.some(i=>!i.confirmed||i.article!==article.version)||task?.imagesRequired&&!latest.length)throw Error("配图待补或文字变更后图片需重新确认");
  const sections=task?validateBody(task.kind,article.body):[{name:"正文",text:article.body}];
  const files=[{name:"正文.md",data:Buffer.from(article.body)}];
  const db=productionDb();
  try{
    for(const i of latest){
      const a=db.prepare("SELECT bytes FROM production_assets WHERE id=?").get(i.asset)!;
      files.push({name:"图片/"+i.page+"-v"+i.version+"-"+i.name,data:Buffer.from(a.bytes as Uint8Array)});
    }
  }finally{db.close();}
  files.push({name:"清单.json",data:Buffer.from(JSON.stringify({taskId:id,articleVersion:article.version,title:article.title,kind:task?.kind??"历史文章",rules:task?.rules,sections,images:latest},null,2))});
  return zip(files);
}
