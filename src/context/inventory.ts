import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { ResourceRecord } from "./types";

const sourceRoot = path.join(
  process.cwd(),
  "resources",
  "source-pack",
  "content-production-system",
);
const systemRoot = path.join(process.cwd(), "resources", "system");

function normalizePath(value: string) {
  return value.split(path.sep).join("/");
}

async function walk(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) return walk(root, fullPath);
      if (entry.isFile()) return [fullPath];
      return [];
    }),
  );
  return files.flat();
}

async function inspectFile(
  absolutePath: string,
  root: "source" | "system",
  rootPath: string,
): Promise<ResourceRecord> {
  const [bytes, metadata] = await Promise.all([
    readFile(absolutePath),
    stat(absolutePath),
  ]);
  const relativePath = normalizePath(path.relative(rootPath, absolutePath));
  return {
    id: `${root}:${relativePath}`,
    root,
    relativePath,
    absolutePath,
    extension: path.extname(absolutePath).toLowerCase(),
    bytes: metadata.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function buildResourceInventory(): Promise<ResourceRecord[]> {
  const [sourceFiles, systemFiles] = await Promise.all([
    walk(sourceRoot),
    walk(systemRoot),
  ]);
  const records = await Promise.all([
    ...sourceFiles.map((file) => inspectFile(file, "source", sourceRoot)),
    ...systemFiles.map((file) => inspectFile(file, "system", systemRoot)),
  ]);
  return records.sort((a, b) =>
    `${a.root}:${a.relativePath}`.localeCompare(
      `${b.root}:${b.relativePath}`,
      "zh-CN",
    ),
  );
}

export async function readResourceText(record: ResourceRecord) {
  if (![".md", ".yaml", ".yml", ".txt"].includes(record.extension)) {
    throw new Error(`Binary resource cannot be injected as text: ${record.relativePath}`);
  }
  return readFile(record.absolutePath, "utf8");
}
