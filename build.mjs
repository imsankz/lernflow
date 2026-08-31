import { buildSync } from "esbuild";
import { readdirSync, statSync, cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function entries(dir, base = dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...entries(p, base));
    else if (f.endsWith(".ts")) out.push(p);
  }
  return out;
}

buildSync({
  entryPoints: entries("src"),
  outdir: "dist",
  format: "esm",
  platform: "node",
  target: "node18",
  outbase: "src",
});

mkdirSync("dist", { recursive: true });
cpSync("py", "dist/py", { recursive: true });
console.log("built", entries("src").length, "modules + py/");
