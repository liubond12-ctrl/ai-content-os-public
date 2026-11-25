import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {knowledge,retrieve,searchAndAssemble, type Chunk} from '../src/rag/search';
// Set RAG_BASELINE to the preserved old index to demonstrate regression failures.
const kb=process.env.RAG_BASELINE?JSON.parse(await readFile(process.env.RAG_BASELINE,'utf8')) as {chunks:Chunk[]}:await knowledge();
const topicFile='05_选题实验与复盘规则.md';
const template='04_正文与配图生产模板.md';
const chunk=(path:string,needle:string)=>{const c=kb.chunks.find(c=>c.path===path&&c.text.includes(needle));expect(c).toBeDefined();return c!;};
describe('Phase 2.1 evidence regressions',()=>{
 for(const [persona,other,needle] of [['demoa','demob','三年级还在学图形化'],['demob','demoa','低年级孩子不主动']] as const){
  it(`${persona} topic retains parent ownership and exact ID`,()=>{
   const c=chunk(topicFile,needle);expect(c.persona).toBe(persona);
   expect(c.id).toBe(createHash('sha256').update(c.path+c.location+String(c.offset)+c.text).digest('hex'));
   const own=retrieve(kb.chunks,needle,persona), foreign=retrieve(kb.chunks,needle,other);
   expect(own.hits.map(h=>h.id)).toContain(c.id);expect(foreign.hits.map(h=>h.id)).not.toContain(c.id);
   expect(foreign.excluded.find(e=>e.id===c.id)?.path).toBe(topicFile);
   expect(c.kind).toBe('production-sop');
  });
 }
 it('inline account labels split pinned comments',()=>{
  const rows=kb.chunks.filter(c=>c.path===template&&c.heading.includes('置顶评论'));
  expect(rows.some(c=>c.persona==='demoa')).toBe(true);expect(rows.some(c=>c.persona==='demob')).toBe(true);
  for(const c of rows)expect(c.text.includes('示例甲：')&&c.text.includes('示例乙：')).toBe(false);
 });
 it('Scratch must not leak the DemoA experimental topic to DemoB',()=>{
  const c=chunk(topicFile,'三年级还在学图形化');const r=retrieve(kb.chunks,'Scratch','demob');
  expect(r.hits.map(h=>h.id)).not.toContain(c.id);expect(r.excluded.map(e=>e.id)).toContain(c.id);
 });
 it('GESP persona output rules are not examination facts',()=>{
  const c=kb.chunks.find(c=>c.path.includes('xhs-demoa-persona/SKILL')&&c.text.includes('GESP')&&c.heading.includes('Output'))!;
  expect(c).toBeDefined();expect(c.kind).toBe('expression-rule');expect(c.verified).toBe(false);
  expect(retrieve(kb.chunks,'GESP','demoa').evidenceStatus.reliableFacts).toBe(0);
 });
 it('fact insufficiency and unknown date are evidence based',()=>{
  const r=retrieve(kb.chunks,'GESP','demoa');expect(r.warnings.join()).toContain('事实依据不足');
  expect(r.evidenceStatus.currentVerifiedFacts).toBe(0);expect(r.evidenceStatus.temporalVerificationPerformed).toBe(false);
  for(const c of r.hits){expect(c.temporal.status).toBe('unknown');expect(c.temporal.publicationDate).toBe('unknown');expect(c.sources[0].modifiedAt).toBeGreaterThan(0);}
 });
 it('unknown and mixed sections cannot become shared',()=>{
  const unresolved=kb.chunks.filter(c=>['unknown','mixed'].includes(c.persona));expect(unresolved.length).toBeGreaterThan(0);
  for(const p of ['demoa','demob']){const r=retrieve(kb.chunks,'账号',p);for(const c of unresolved)expect(r.excluded.map(e=>e.id)).toContain(c.id);}
 });
 it('real common rules remain accessible to both accounts',()=>{
  const c=chunk('00_总控生产规则.md','统一写作习惯');expect(c.persona).toBe('shared');
  for(const p of ['demoa','demob'])expect(retrieve(kb.chunks,'统一写作习惯',p).hits.map(h=>h.id)).toContain(c.id);
 });
 it('empty result has no evidence and explicit failure',()=>{
  const r=retrieve(kb.chunks,'zyxunicorn987','demob');expect(r.hits).toEqual([]);expect(r.warnings).toContain('没有找到相关资料。');expect(r.evidenceStatus.reliableFacts).toBe(0);
 });
 it('server assembly preserves exact evidence identity and classification',async()=>{
  const r=await searchAndAssemble('GESP','demoa');
  for(const c of r.retrieval.hits){const e=r.assembly.manifest.retrievedEvidence.find(e=>e.id===c.id)!;expect(e.path).toBe(c.path);expect(e.persona).toBe(c.persona);expect(e.kind).toBe(c.kind);expect(e.temporal).toEqual(c.temporal);expect(e.sources).toEqual(c.sources);}
 });
});
