import {readFile} from "node:fs/promises";
import path from "node:path";
const files:Record<string,string>={scope:"reauthorization.json",style:"style-control.json",matrix:"completion.md",checks:"completion-checks.txt",article:"最后一张校样.md",browser:"normal.json",exceptions:"browser.json",tests:"regression.txt",replay:"comparison.json",paired:"paired-flow.json",restore:"restored.txt",notes:"notes.md"};
export async function GET(req:Request){
  const key=new URL(req.url).searchParams.get("name")??"",file=Object.hasOwn(files,key)?files[key]:null;
  if(!file)return new Response(null,{status:404});
  const data=await readFile(path.join(process.cwd(),"docs","evidence","workbench",file),"utf8");
  return new Response(data,{headers:{"Content-Type":file.endsWith(".json")?"application/json;charset=utf-8":"text/plain;charset=utf-8","Cache-Control":"no-store",...(key==="article"?{"Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(file)}:{})}});
}
