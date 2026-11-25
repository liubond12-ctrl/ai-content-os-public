import {ragIndexPath} from '../src/rag/index-path.ts';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {buildVectorIndex} from '../src/rag/embedding.ts';
const kb=JSON.parse(await readFile(ragIndexPath('knowledge.json'),'utf8'));
let old;try{old=JSON.parse(await readFile(ragIndexPath('vectors.json'),'utf8'));}catch{}
const result=await buildVectorIndex(kb.chunks,old);
await writeFile(ragIndexPath('vectors.json')+'.tmp',JSON.stringify(result));await rename(ragIndexPath('vectors.json')+'.tmp',ragIndexPath('vectors.json'));
console.log(JSON.stringify({...result,vectors:result.vectors.length},null,2));
