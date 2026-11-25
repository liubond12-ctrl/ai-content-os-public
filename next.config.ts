import type { NextConfig } from "next";
import {createHash} from "node:crypto";
import {existsSync,readdirSync,readFileSync} from "node:fs";
import path from "node:path";
const hash=createHash("sha256");
for(const file of ["next.config.ts","package.json",...readdirSync("src",{recursive:true}).filter(f=>/\.(tsx?|css)$/.test(String(f))).map(f=>path.join("src",String(f)))].sort()){
  hash.update(file).update(readFileSync(file));
}
const buildId="studio-"+hash.digest("hex").slice(0,16);

const nextConfig: NextConfig = {
  // The demo may be updated while the personal workspace serves its current build.
  distDir: process.env.STUDIO_NEXT_DIST_DIR || (process.env.STUDIO_DEMO_INSTANCE === "1" &&
    existsSync(".next/cockpit-demo/BUILD_ID") ? ".next/cockpit-demo" : ".next"),
  reactStrictMode: true,
  generateBuildId:async()=>buildId,
  env:{NEXT_PUBLIC_STUDIO_BUILD:buildId},
  serverExternalPackages: ['@larksuiteoapi/node-sdk', '@huggingface/transformers', 'onnxruntime-node'],
};

export default nextConfig;
