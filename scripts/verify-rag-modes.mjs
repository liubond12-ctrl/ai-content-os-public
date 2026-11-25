import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const base=process.argv[2]||'http://127.0.0.1:3004';
const {cases}=JSON.parse(await readFile('tests/fixtures/rag-eval.json','utf8'));
const kb=JSON.parse(await readFile('data/knowledge.json','utf8'));
const rows=[];
for(const mode of ['keyword','semantic','hybrid'])for(const c of cases){
 const start=performance.now();const response=await fetch(base+'/api/rag',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:c.query,persona:c.persona,mode})});
 assert.equal(response.status,200);const r=await response.json();assert.equal(r.retrieval.mode,mode);
 for(const h of r.retrieval.hits){
  assert.ok([c.persona,'shared'].includes(h.persona));assert.ok(!c.forbidden.includes(h.id));
  const original=kb.chunks.find(o=>o.id===h.id);assert.ok(original);assert.equal(original.text,h.text);assert.equal(original.kind,h.kind);assert.equal(original.path,h.path);
  const e=r.assembly.manifest.retrievedEvidence.find(e=>e.id===h.id);assert.equal(e.retrievalMode,mode);assert.equal(e.finalRank,h.finalRank);assert.deepEqual(e.sources,h.sources);assert.ok(r.assembly.compiledContext.includes(h.id));
 }
 if(c.category==='facts-missing'){assert.equal(r.retrieval.evidenceStatus.reliableFacts,0);assert.ok(r.retrieval.warnings.includes('缺少可核实的当前资料'));}
 if(c.category==='empty')assert.equal(r.retrieval.hits.length,0);
 rows.push({case:c.id,mode,query:c.query,persona:c.persona,httpMs:performance.now()-start,retrieval:r.retrieval,evidenceCount:r.assembly.manifest.retrievedEvidence.length});
}
const invalid=await fetch(base+'/api/rag',{method:'POST',body:JSON.stringify({query:'test',persona:'demoa',mode:'imaginary'})});assert.equal(invalid.status,400);
await mkdir('.audit/phase22',{recursive:true});await writeFile('.audit/phase22/api-results.json',JSON.stringify(rows,null,2));
console.log(JSON.stringify({passed:rows.length,failed:0,invalidModeRejected:true},null,2));
