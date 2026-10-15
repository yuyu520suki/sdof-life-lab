import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const directory = resolve("public/solver-assets");
mkdirSync(directory, { recursive: true });
for (const [source, destination] of [
  ["node_modules/highs/build/highs.wasm", "highs.wasm"],
  ["node_modules/highs/LICENSE", "HIGHS-JS-LICENSE.txt"],
]) {
  if (!existsSync(source)) throw new Error(`Required pinned solver asset is missing: ${source}`);
  copyFileSync(source, resolve(directory, destination));
}
console.log("Pinned HiGHS WASM and license copied to same-origin public assets.");
