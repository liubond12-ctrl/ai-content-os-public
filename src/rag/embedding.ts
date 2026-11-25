import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ragIndexPath} from './index-path.ts';
import {env,pipeline,type FeatureExtractionPipeline} from '@huggingface/transformers';

export const MODEL={name:'Xenova/bge-small-zh-v1.5',revision:'75c43b069aac4d136ba6bc1122f995fedcfd2781',dimensions:512,dtype:'q8',pooling:'cls',normalize:true,queryPrefix:'为这个句子生成表示以用于检索相关文章：',maxTokens:512,runtime:'@huggingface/transformers@3.8.1 / ONNX Runtime CPU'};
env.allowRemoteModels=false;
env.localModelPath=path.resolve('models')+path.sep;
let extractor:Promise<FeatureExtractionPipeline>|undefined;
// Narrow the library's large task union to the one task used here.
const createExtractor=pipeline as unknown as (task:'feature-extraction',model:string,options:Record<string,unknown>)=>Promise<FeatureExtractionPipeline>;
async function verifiedExtractor(){
 const dir=path.resolve('models',MODEL.name);
 const manifest=JSON.parse((await readFile(path.join(dir,'download-manifest.json'),'utf8')).replace(/^\uFEFF/,'')) as {revision?:string;model:string|{name:string;revision:string};files:Array<{file:string;sha256:string}>};
 const name=typeof manifest.model==='string'?manifest.model:manifest.model.name;
 const revision=typeof manifest.model==='string'?manifest.revision:manifest.model.revision;
 if(name!==MODEL.name||revision!==MODEL.revision)throw Error('本地模型下载版本不匹配');
 for(const file of ['config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','onnx/model_quantized.onnx']){
  const expected=manifest.files.find(f=>f.file===file)?.sha256;
  const actual=createHash('sha256').update(await readFile(path.join(dir,file))).digest('hex');
  if(actual!==expected)throw Error('本地模型文件校验失败：'+file);
 }
 return createExtractor('feature-extraction',MODEL.name,{dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:2,interOpNumThreads:1}});
}
export function contentHash(text:string){return createHash('sha256').update(text).digest('hex');}
export function documentText(c:{heading:string;text:string}){return c.heading+'\n'+c.text;}
export async function embed(text:string,query=false):Promise<number[]>{
 try{
  extractor??=verifiedExtractor();
  const pipe=await extractor;
  const output=await pipe((query?MODEL.queryPrefix:'')+text,{pooling:'cls',normalize:true});
  const vector=Array.from(output.data,Number);
  if(vector.length!==MODEL.dimensions||vector.some(x=>!Number.isFinite(x)))throw Error('向量维度或数值异常');
  return vector;
 }catch(e){extractor=undefined;throw Error('本地 Embedding 不可用：'+(e instanceof Error?e.message:String(e)));}
}
export type VectorIndex={model:typeof MODEL;generatedAt:string;durationMs:number;generatedCount:number;reusedCount:number;vectors:Array<{id:string;contentHash:string;values:number[]}>};
export async function buildVectorIndex(chunks:Array<{id:string;heading:string;text:string}>,old?:VectorIndex):Promise<VectorIndex>{
 const start=performance.now();
 const cache=new Map(old&&JSON.stringify(old.model)===JSON.stringify(MODEL)?old.vectors.map(v=>[v.contentHash,v.values]):[]);
 const vectors:VectorIndex['vectors']=[];let generatedCount=0,reusedCount=0;
 for(const c of chunks){
  const text=documentText(c), hash=contentHash(text);let values=cache.get(hash);
  if(!values||values.length!==MODEL.dimensions||values.some(x=>!Number.isFinite(x))||values.every(x=>x===0)){values=await embed(text);generatedCount++;cache.set(hash,values);}else reusedCount++;
  vectors.push({id:c.id,contentHash:hash,values});
 }
 return {model:MODEL,generatedAt:new Date().toISOString(),durationMs:performance.now()-start,generatedCount,reusedCount,vectors};
}
export function cosine(a:number[],b:number[]){
 if(a.length!==b.length)throw Error('向量维度不匹配');
 let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
 return dot/Math.sqrt(aa*bb);
}
export async function loadVectors(chunks:Array<{id:string;heading:string;text:string}>):Promise<VectorIndex>{
 let index:VectorIndex;
 try{index=JSON.parse(await readFile(ragIndexPath('vectors.json'),'utf8')) as VectorIndex;}
 catch{throw Error('本地向量索引不可用或格式损坏，请运行 npm run index:vectors；未自动退回关键词模式。');}
 if(JSON.stringify(index.model)!==JSON.stringify(MODEL))throw Error('向量索引模型版本不兼容，请运行 npm run index:vectors');
 const map=new Map(index.vectors.map(v=>[v.id,v]));
 if(map.size!==chunks.length||index.vectors.length!==chunks.length||chunks.some(c=>{const v=map.get(c.id);return !v||v.contentHash!==contentHash(documentText(c))||v.values.length!==MODEL.dimensions||v.values.some(x=>!Number.isFinite(x))||v.values.every(x=>x===0);}))throw Error('向量索引缺失、损坏或内容已变化，请运行 npm run index:vectors');
 return index;
}
