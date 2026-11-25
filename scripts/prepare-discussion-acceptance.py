"""Create private review-only working copies. Original databases are opened read-only."""
import json
import os
import sqlite3
import tempfile
from pathlib import Path

workspace = Path(__file__).resolve().parents[1]
root = Path(os.environ["LOCALAPPDATA"]) / "AI-Content-OS" / "acceptance"
root.mkdir(parents=True, exist_ok=True)
run = Path(tempfile.mkdtemp(prefix="discussion-", dir=root))
def copy_db(source, destination):
    source_db = sqlite3.connect(source.as_uri()+"?mode=ro", uri=True)
    dest_db = sqlite3.connect(destination)
    try:
        source_db.backup(dest_db)
    finally:
        source_db.close()
        dest_db.close()

for name, directory in [("demo", "data-production-demo"), ("real", "data-production-real-phase1")]:
    target = run / name
    target.mkdir()
    for file in ["studio.sqlite", "content-library.sqlite"]:
        copy_db(workspace / directory / file, target / file)

# Reuse a completed synthetic human decision from the previous local Feishu acceptance.
db = sqlite3.connect(run / "demo" / "studio.sqlite", uri=True)
author_task = None
for folder in sorted(Path(tempfile.gettempdir()).glob("feishu-card-browser-*"), key=lambda p:p.stat().st_mtime, reverse=True):
    file = folder / "studio.sqlite"
    if not file.exists():
        continue
    db.execute("ATTACH DATABASE ? AS sample",(file.as_uri()+"?mode=ro",))
    row = db.execute("SELECT task_id FROM sample.article_snapshots WHERE json_extract(payload,'$.decision.opinionId') IS NOT NULL LIMIT 1").fetchone()
    if row:
        author_task = row[0]
        batch = db.execute("SELECT batch FROM sample.production_queue WHERE task=?",row).fetchone()[0]
        for table,field,key in [("production_batches","id",batch),("production_queue","task",author_task),("versions","id",author_task),("article_snapshots","task_id",author_task),("article_drafts","task_id",author_task),("collaboration","task",author_task),("reviews","task",author_task),("model_calls","task_id",author_task)]:
            db.execute(f"INSERT INTO {table} SELECT * FROM sample.{table} WHERE {field}=?", (key,))
        db.commit()
        db.execute("DETACH DATABASE sample")
        break
    db.execute("DETACH DATABASE sample")
missing = db.execute("SELECT id FROM versions WHERE id NOT IN (SELECT task FROM collaboration) LIMIT 1").fetchone()[0]
db.close()
print(json.dumps({"folder":str(run),"authorTask":author_task,"missing":missing},ensure_ascii=False))