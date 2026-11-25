import {describe,it,expect} from 'vitest';
import {knowledge,retrieveMode,exclusion,searchAndAssemble,fuse,RRF_K,type Mode} from '../src/rag/search';
import {MODEL,embed,cosine,loadVectors,buildVectorIndex} from '../src/rag/embedding';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const kb=await knowledge();
describe('real local Embedding and Hybrid correctness',()=>{
 it('Persisted real normalized vectors match model and source hashes',async()=>{
  const index=await loadVectors(kb.chunks);expect(index.vectors).toHaveLength(kb.chunks.length);expect(index.model).toEqual(MODEL);
  for(const v of index.vectors){expect(v.values).toHaveLength(512);expect(v.values.reduce((s,x)=>s+x*x,0)).toBeCloseTo(1,4);}
  const c=kb.chunks[0];expect(cosine(await embed(c.heading+'\n'+c.text),index.vectors[0].values)).toBeCloseTo(1,5);
 });
 it('changed content rejects stale vectors',async()=>{
  const changed=kb.chunks.map((c,i)=>i===0?{...c,text:c.text+' changed'}:c);
  await expect(loadVectors(changed)).rejects.toThrow('内容已变化');
 });
 it('incremental build reuses unchanged vectors, embeds changed content and drops deleted IDs',async()=>{
  const old=await loadVectors(kb.chunks);
  const next=await buildVectorIndex([kb.chunks[0],{...kb.chunks[1],text:kb.chunks[1].text+'新增测试句。'}],old);
  expect(next.reusedCount).toBe(1);expect(next.generatedCount).toBe(1);expect(next.vectors).toHaveLength(2);
  expect(next.vectors[0].values).toEqual(old.vectors[0].values);expect(next.vectors[1].contentHash).not.toBe(old.vectors[1].contentHash);
 });
 it('missing local model fails explicitly without remote inference or fallback',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'rag-model-unavailable-'));
  const url=pathToFileURL(path.resolve('src/rag/embedding.ts')).href;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',`import {embed} from ${JSON.stringify(url)}; try {await embed('测试');process.exitCode=1;} catch(e){console.log(e.message);}`],{cwd:dir});
  expect(stdout).toContain('本地 Embedding 不可用');expect(stdout).toContain('download-manifest.json');
 });
 it('Chinese paraphrase similarity exceeds unrelated topic',async()=>{
  const q=await embed('怎样通过下雨时照顾同行者的举动表现一个人的体贴',true);
  const related=await embed('他把伞整个倾向她，自己半边肩膀湿透了');
  const unrelated=await embed('火星核聚变反应堆维修手册');
  expect(cosine(q,related)).toBeGreaterThan(cosine(q,unrelated));
 });
 for(const mode of ['keyword','semantic','hybrid'] as Mode[]){
  it(`${mode} enforces both account and language filters with real hits`,async()=>{
   for(const persona of ['demoa','demob'])for(const query of ['孩子主动学习','Python','C++']){
    const r=await retrieveMode(kb.chunks,query,persona,mode);
    for(const h of r.hits)expect(exclusion(h,query,persona)).toBeNull();
    for(const c of kb.chunks.filter(c=>exclusion(c,query,persona)))expect(r.excluded.map(e=>e.id)).toContain(c.id);
   }
   const shared=await retrieveMode(kb.chunks,'统一写作习惯','demob',mode);
   expect(shared.hits.some(h=>h.heading.includes('统一写作习惯')&&h.persona==='shared')).toBe(true);
  });
  it(`${mode} evidence is passed into server context with exact ranks and sources`,async()=>{
   const r=await searchAndAssemble('统一写作习惯','demoa',mode);expect(r.retrieval.hits.length).toBeGreaterThan(0);
   for(const h of r.retrieval.hits){const e=r.assembly.manifest.retrievedEvidence.find(e=>e.id===h.id)!;expect(e.sources).toEqual(h.sources);expect(e.kind).toBe(h.kind);expect(e.retrievalMode).toBe(mode);expect(e.finalRank).toBe(h.finalRank);expect(r.assembly.compiledContext).toContain(h.id);}
   expect(r.retrieval.evidenceStatus.reliableFacts).toBe(0);
   const exam=await searchAndAssemble('GESP','demoa',mode);
   expect(exam.retrieval.evidenceStatus.reliableFacts).toBe(0);
   expect(exam.retrieval.warnings).toContain('缺少可核实的当前资料');
  });
 }
 it('RRF uses ranks rather than unnormalized scores',async()=>{
  const base=(await retrieveMode(kb.chunks,'统一写作习惯','demob')).hits[0];
  const result=fuse([{...base,score:99999,keywordRank:2}],[{...base,score:0.7,semanticRank:3,similarity:0.7}]);
  expect(result[0].score).toBeCloseTo(1/(RRF_K+2)+1/(RRF_K+3));
  expect(result[0].keywordRank).toBe(2);expect(result[0].semanticRank).toBe(3);
 });
 it('semantic retrieval rescues a grounded paraphrase missed by keywords',async()=>{
  const q='雨中如何用遮伞的动作体现关心';
  const keyword=await retrieveMode(kb.chunks,q,'demob','keyword'), semantic=await retrieveMode(kb.chunks,q,'demob','semantic');
  expect(keyword.hits.slice(0,3).some(h=>h.heading.includes('虚构场景'))).toBe(false);
  expect(semantic.hits.slice(0,3).some(h=>h.heading.includes('虚构场景'))).toBe(true);
 });
});
