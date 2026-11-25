// Only public model weights are downloaded. No business text leaves this machine.
import {mkdir,writeFile} from 'node:fs/promises';
import {MODEL} from '../src/rag/embedding.ts';
import {createHash} from 'node:crypto';
const files=['config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','onnx/model_quantized.onnx'];
const manifest={model:MODEL,files:[]};
for(const file of files){
 const url=`https://huggingface.co/${MODEL.name}/resolve/${MODEL.revision}/${file}`;
 const response=await fetch(url);if(!response.ok)throw Error(`${file}: ${response.status}`);
 const buffer=Buffer.from(await response.arrayBuffer());const dest=`models/${MODEL.name}/${file}`;
 await mkdir(dest.substring(0,dest.lastIndexOf('/')),{recursive:true});await writeFile(dest,buffer);
 manifest.files.push({file,bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')});console.log(file,buffer.length);
}
await writeFile(`models/${MODEL.name}/download-manifest.json`,JSON.stringify(manifest,null,2));
