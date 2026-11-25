"""Scan the public branch without printing the content that triggered a rule."""
import argparse
import json
import re
import subprocess
from pathlib import Path


def git(*args):
    return subprocess.check_output(["git", *args])


parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
options = parser.parse_args()
patterns = {
    "credential-token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|(?:AKIA|ASIA)[A-Z0-9]{16}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,})\b"),
    "private-key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----"),
    "jwt-shape": re.compile(rb"\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{24,}\b"),
    "literal-credential-assignment": re.compile(rb"(?im)^\s*(?:STUDIO_MODEL_KEY|STUDIO_FEISHU_TOKEN|FEISHU_CARD_APP_SECRET|FEISHU_LEDGER_WRITE_TOKEN|FEISHU_CARD_WORKER_KEY|OPENAI_API_KEY|DEEPSEEK_API_KEY)\s*=\s*['\"]?[A-Za-z0-9_\-]{18,}"),
    "private-local-path": re.compile(rb"(?i)(?:[A-Z]:[/\\]{1,2}Users[/\\]{1,2}[^<>{}\[\]\r\n\/\\]+[/\\]|D:[/\\]{1,2}demo(?![-\w]))"),
}
private_path = re.compile(r"(^|/)(?:\.env(?:\.[^/]+)?|[^/]+\.(?:sqlite3?|db)(?:-wal|-shm)?|[^/]+\.(?:key|pem)|\.studio-demo|network-guard\.jsonl)$", re.I)
samples = {"data/studio.sqlite", "data/studio.sqlite-wal", "data/content-library.sqlite",
           ".env.local", ".env", "data-production-demo/studio.sqlite",
           "models/bge/model.onnx", ".next/BUILD_ID", "worker.key", ".studio-demo", "network-guard.jsonl"}
visible = [path.decode("utf-8", "replace") for path in git("ls-files", "-z").split(b"\0") if path]
tracked_private = [path for path in visible if private_path.search(path) and not path.endswith(".example")]
checks = {}
for path in sorted(samples):
    check = subprocess.run(["git", "check-ignore", "--no-index", "-q", "--", path], check=False)
    checks[path] = check.returncode == 0

blobs, findings, skipped = 0, [], []
proc = subprocess.Popen(["git", "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
try:
    for line in git("-c", "core.quotePath=false", "rev-list", "--objects", "HEAD").splitlines():
        oid, _, path = line.partition(b" ")
        if not path:
            continue
        proc.stdin.write(oid + b"\n")
        proc.stdin.flush()
        fields = proc.stdout.readline().split()
        if len(fields) != 3:
            raise RuntimeError("git object could not be scanned")
        size = int(fields[2])
        payload = proc.stdout.read(size)
        proc.stdout.read(1)
        if fields[1] != b"blob":
            continue
        blobs += 1
        name = path.decode("utf-8", "replace")
        kinds = {key for key, pattern in patterns.items() if pattern.search(payload)}
        if private_path.search(name) and not name.endswith(".example"):
            kinds.add("private-file-path")
        if b"\0" in payload[:8192]:
            skipped.append(name)
        for kind in sorted(kinds):
            findings.append({"type": kind, "path": name, "object": oid[:12].decode()})
finally:
    proc.stdin.close()
    proc.wait()

report = {
    "head": git("rev-parse", "HEAD").decode().strip(),
    "reachableCommits": int(git("rev-list", "--count", "HEAD")),
    "reachableBlobs": blobs, "trackedPaths": len(visible), "trackedPrivatePaths": tracked_private,
    "matches": findings, "binaryPathsPatternScanned": sorted(set(skipped)), "ignoreChecks": checks,
    "limits": "Pattern scan of raw reachable blobs and paths. No decoding of archived or encrypted payloads and no credential authentication.",
}
options.output.parent.mkdir(parents=True, exist_ok=True)
options.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({k: report[k] for k in ("head", "reachableCommits", "reachableBlobs", "trackedPaths", "trackedPrivatePaths", "matches", "ignoreChecks")}, ensure_ascii=False))
