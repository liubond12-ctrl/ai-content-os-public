// Read-only proxy over existing isolated evidence. No model server.
import {createServer,request} from 'node:http';
import {readFileSync,copyFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const evidence=JSON.parse(readFileSync('docs/evidence/phase3.5-professional-browser.json','utf8'));
const dir=mkdtempSync(path.join(tmpdir(),'phase35-readonly-')),database=path.join(dir,'studio.sqlite');
copyFileSync(evidence.database,database);
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3020'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,STUDIO_DB:database,STUDIO_LIBRARY_DB:path.join(dir,'library.sqlite'),STUDIO_MODEL:'',STUDIO_MODEL_KEY:'',STUDIO_MODEL_URL:'http://127.0.0.1:1/disabled',STUDIO_SAFE_DEMO_APPROVED_SHA256:'',STUDIO_SAFE_EVAL_APPROVED_SHA256:''},stdio:['ignore','inherit','inherit']});
const labels={clean:'无实质分歧：直接待人工确认（2次模拟调用 / 300 Tokens）',conflict:'实质分歧：讨论、Judge、修订和复审（8次 / 1200 Tokens）',facts:'关键事实缺失：事实阻断（3次 / 450 Tokens）'};
const rows=['clean','conflict','facts'].map(kind=>{const r=evidence.results.find(r=>r.kind===kind);return `<li><a href="/studio/editor?taskId=${r.flow.taskId}">${labels[kind]}</a></li>`;}).join('');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Phase 3.5 模拟验收 · 只读</title><style>body{font:18px/1.8 system-ui;max-width:960px;margin:60px auto;padding:24px}li{margin:24px 0}a{color:#164fc6}</style><h1>Phase 3.5 隔离模拟验收 · 只读</h1><p>复用已通过验收的执行记录与数据库副本。模型回执来自当时的本机模拟服务，不是 DeepSeek 结果。本入口未启动模型，禁止所有写入。</p><ol>${rows}</ol><h2>查看顺序</h2><p>展开各专业意见 → 交叉讨论与意见关联 → Judge 裁决 → 执行记录与用量。页面下方展开“版本差异”，以 v3 为基准查看 v4。</p><p>事实场景展开“本轮完整审核与裁决记录”，查看 facts.checks 中的“待核验”。Judge 没有被调用：事实阻断在代码层优先，不能投票放行。</p><p>现有编辑页仍有保存、恢复、停止等按钮，但此入口禁止写入；只需查看。版本选择和展开详情可正常使用。</p><p>已知显示问题：历史版本下拉可能把 ai-revision 显示成“人工编辑”；实际字段是 ai-revision。请结合原始版本记录核对。</p><ul>${evidence.results.map(r=>`<li>${r.kind}：<a href="/api/articles?taskId=${r.flow.taskId}">版本JSON</a> · <a href="/api/collaboration?taskId=${r.flow.taskId}">执行JSON</a></li>`).join('')}</ul><p>只读端口3019；原工作台3000及真实v7/v8/v9不变。</p></html>`;
const server=createServer((req,res)=>{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'模拟验收只读入口：禁止修改、停止、重试或模型调用'}));return;}
 if(req.url==='/'||req.url==='/acceptance'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;}
 const upstream=request({host:'127.0.0.1',port:3020,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:3020'}},r=>{res.writeHead(r.statusCode??502,r.headers);r.pipe(res);});upstream.on('error',()=>{res.writeHead(503);res.end('验收服务启动中，请稍后刷新');});upstream.end();
});
server.on('error',e=>{console.error(e);child.kill();process.exit(1);});child.on('exit',code=>{server.close();process.exit(code??1);});
server.listen(3019,'127.0.0.1',()=>{writeFileSync('docs/evidence/phase3.5-readonly-session.json',JSON.stringify({pid:process.pid,backendPid:child.pid,database,source:evidence.database,url:'http://127.0.0.1:3019/',started:new Date().toISOString()},null,2));console.log('Read-only acceptance http://127.0.0.1:3019/');});
process.on('SIGTERM',()=>{child.kill();server.close();});
