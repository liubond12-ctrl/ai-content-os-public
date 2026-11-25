import assert from "node:assert/strict";
import {readFileSync,writeFileSync,copyFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";
import {createServer} from "vite";
const report=JSON.parse(readFileSync("docs/evidence/content-reuse-measurements.json"));
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom",configFile:false});
try{
  const {openContent}=await vite.ssrLoadModule("/src/studio/content-index.ts");
  const {readArticles,ArticleUnavailable}=await vite.ssrLoadModule("/src/studio/article-store.ts");
  const checks=[];
  for(const sample of report.migrations){
    const path=join(report.folder,sample.dir+"-fault.sqlite"),base=join(report.folder,sample.dir+"-backup.sqlite");
    copyFileSync(base,path);process.env.STUDIO_DB=path;
    let db=new DatabaseSync(path);db.prepare("INSERT INTO versions VALUES('fault-probe',1,'broken')").run();db.close();
    assert.throws(()=>openContent());db=new DatabaseSync(path);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='content_heads'").get(),undefined);db.close();
    copyFileSync(base,path);db=openContent();const heads=db.prepare("SELECT id,title,body,version,kind FROM content_heads").all();db.close();
    let articles=0,free=0;
    for(const h of heads){
      try{const source=readArticles(h.id).head;assert.equal(h.title,source.title);assert.equal(h.body,source.body);assert.equal(h.version,source.version);articles++;if(h.kind==="自由文章")free++;}
      catch(e){if(!(e instanceof ArticleUnavailable))throw e;assert.equal(h.version,0);}
    }
    checks.push({source:sample.dir,allHeads:heads.length,formalArticles:articles,freeArticles:free,failedMigrationRolledBack:true,backupRestored:true});
  }
  const probe=new DatabaseSync(":memory:");
  probe.exec("CREATE VIRTUAL TABLE chinese USING fts5(body,tokenize='trigram');INSERT INTO chinese VALUES('先折叠，竖放。')");
  const fts={sqlite:probe.prepare("SELECT sqlite_version() v").get().v,threeChars:probe.prepare("SELECT count(*) n FROM chinese WHERE chinese MATCH '先折叠'").get().n,twoChars:probe.prepare("SELECT count(*) n FROM chinese WHERE chinese MATCH '折叠'").get().n,literalPunctuation:probe.prepare("SELECT instr(body,'叠，') n FROM chinese").get().n};probe.close();
  writeFileSync("docs/evidence/content-reuse-recovery.json",JSON.stringify({checks,fts},null,2));
}finally{await vite.close();}