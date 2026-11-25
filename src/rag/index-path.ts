import path from "node:path";

export function ragIndexPath(file: "knowledge.json" | "vectors.json") {
  const directory = process.env.STUDIO_DATA_DIR || (process.env.STUDIO_DEMO_INSTANCE === "1" ? "data-production-demo" : "data");
  return path.resolve(directory, file);
}
