#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
const d = dirname(fileURLToPath(import.meta.url));
if (!existsSync(join(d, "..", "dist", "index.js"))) {
  console.error("lernflow: dist/ not built. Run `npm run build` in the repo.");
  process.exit(1);
}
await import(join(d, "..", "dist", "index.js"));
