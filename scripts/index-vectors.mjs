import {readFile,writeFile,rename} from 'node:fs/promises';
import {buildVectorIndex} from '../src/rag/embedding.ts';
const kb=JSON.parse(await readFile('data/knowledge.json','utf8'));
let old;try{old=JSON.parse(await readFile('data/vectors.json','utf8'));}catch{}
const result=await buildVectorIndex(kb.chunks,old);
await writeFile('data/vectors.json.tmp',JSON.stringify(result));await rename('data/vectors.json.tmp','data/vectors.json');
console.log(JSON.stringify({...result,vectors:result.vectors.length},null,2));
