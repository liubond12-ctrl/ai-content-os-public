import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
const base='http://127.0.0.1:3019';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);const links=await page.locator('ol a').evaluateAll(nodes=>nodes.map(n=>({label:n.textContent,url:n.href})));const rows=[];
for(const link of links){await page.goto(link.url);await page.getByRole('heading',{name:/专业审核/}).first().waitFor();const id=new URL(link.url).searchParams.get('taskId');const data=await fetch(base+'/api/collaboration?taskId='+id).then(r=>r.json());rows.push({label:link.label,state:data.flow.state,usage:data.usage});}
const blocked=await fetch(base+'/api/collaboration',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(blocked.status!==403)throw Error('Read-only protection failed');await page.goto(base);await page.screenshot({path:'docs/evidence/phase3.5-readonly-portal.png',fullPage:true});const result={base,rows,writeStatus:blocked.status,errors};writeFileSync('docs/evidence/phase3.5-readonly-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}finally{await browser.close();}
