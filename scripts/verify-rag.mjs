// Run against a live local server: node scripts/verify-rag.mjs [base URL]
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.argv[2]||'http://127.0.0.1:3003';
const kb=JSON.parse(await readFile('data/knowledge.json','utf8'));
const cases=[['demoa','GESP'],['demob','Scratch'],['demoa','三年级还在学图形化'],['demob','低年级孩子不主动'],['demoa','统一写作习惯'],['demob','统一写作习惯'],['demoa','形容词'],['demob','形容词'],['demoa','2027 GESP 报名日期'],['demob','zyxunicorn987']];
const results=[];
for(const [persona,query] of cases){
 const response=await fetch(base+'/api/rag',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({persona,query})});
 assert.equal(response.status,200);const result=await response.json();const r=result.retrieval;
 for(const h of r.hits){
  const original=kb.chunks.find(c=>c.id===h.id);assert.ok(original);assert.equal(h.path,original.path);assert.equal(h.kind,original.kind);
  assert.ok(['shared',persona].includes(h.persona));assert.equal(h.text,original.text);
  const evidence=result.assembly.manifest.retrievedEvidence.find(e=>e.id===h.id);
  assert.equal(evidence.kind,h.kind);assert.equal(evidence.persona,h.persona);assert.deepEqual(evidence.sources,h.sources);assert.deepEqual(evidence.temporal,h.temporal);
  assert.ok(result.assembly.compiledContext.includes(h.id));
 }
 if(query.includes('GESP')){assert.equal(r.evidenceStatus.reliableFacts,0);assert.ok(r.warnings.includes('缺少可核实的当前资料'));}
 if(query==='Scratch')assert.ok(!r.hits.some(h=>h.text.includes('三年级还在学图形化')));
 if(query==='形容词'){assert.ok(r.hits.some(h=>h.path.endsWith('.docx')&&h.sources.length===2&&h.persona==='shared'));}
 if(query==='统一写作习惯')assert.ok(r.hits.some(h=>h.path==='00_总控生产规则.md'&&h.persona==='shared'));
 if(query==='zyxunicorn987'){assert.equal(r.hits.length,0);assert.ok(r.warnings.includes('没有找到相关资料。'));}
 results.push({persona,query,hits:r.hits.map(({id,path,location,persona,kind,text})=>({id,path,location,persona,kind,text})),warnings:r.warnings,evidenceStatus:r.evidenceStatus});
}
await mkdir('.audit/phase21',{recursive:true});await writeFile('.audit/phase21/api-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({passed:results.length,failed:0,scenarios:results.map(r=>({persona:r.persona,query:r.query,hits:r.hits.length,top:r.hits[0]?.path}))},null,2));
