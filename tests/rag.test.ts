import {describe,it,expect} from 'vitest';
import {knowledge,retrieve,searchAndAssemble} from '../src/rag/search';
const kb=await knowledge();
const cases=['GESP','Python','C++','Scratch','阶段测评','评论','封面','配图','主动性','课外班'];
describe('真实文件检索',()=>{
 for(const query of cases)it(query,()=>{const expected=kb.chunks.filter(c=>c.text.toLowerCase().includes(query.toLowerCase()));expect(expected.length).toBeGreaterThan(0);const r=retrieve(kb.chunks,query,['主动性','课外班'].includes(query)?'demob':'demoa');expect(r.hits.slice(0,3).some(c=>c.text.toLowerCase().includes(query.toLowerCase()))).toBe(true);});
 it('账号隔离',()=>expect(retrieve(kb.chunks,'编程','demob').hits.every(c=>c.persona!=='demoa')).toBe(true));
 it('语言筛选',()=>expect(retrieve(kb.chunks,'Python','demoa').hits.every(c=>!c.tags.includes('C++')||c.tags.includes('Python'))).toBe(true));
 it('不存在的事实',()=>expect(retrieve(kb.chunks,'zyxunicorn987','demoa').hits).toHaveLength(0));
 it('考试当前资料缺失',()=>expect(retrieve(kb.chunks,'2027 GESP 报名日期','demoa').warnings).toContain('缺少可核实的当前资料'));
 it('未知时间不冒充最新',()=>expect(kb.chunks.every(c=>c.publicationDate===null&&!c.verified)).toBe(true));
 it('规则冲突提示',()=>expect(retrieve(kb.chunks,'配图','demoa').warnings.join()).toContain('差异'));
 it('改述并非语义检索',()=>expect(retrieve(kb.chunks,'孩子遇到难题就等大人帮忙','demob').mode).toBe('keyword'));
 it('证据进入装配',async()=>{const r=await searchAndAssemble('GESP','demoa');expect(r.assembly.manifest.retrievedEvidence.length).toBeGreaterThan(0);expect(r.assembly.compiledContext).toContain(r.retrieval.hits[0].text.replace(/\n/g,'\\n'));});
});
