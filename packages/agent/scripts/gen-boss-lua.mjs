// Generates boss-reporter-lua.generated.ts from mods/palserver-boss-reporter/Scripts/main.lua.
// The Lua file is the single source of truth (with syntax highlighting and standalone deployment testing); the agent writes it from the generated constant at installation time.
// Usage: node packages/agent/scripts/gen-boss-lua.mjs (or pnpm --filter @palserver/agent gen:boss-lua)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const luaPath = path.join(repoRoot, "mods", "palserver-boss-reporter", "Scripts", "main.lua");
const outPath = path.join(here, "..", "src", "boss-reporter-lua.generated.ts");

const lua = fs.readFileSync(luaPath, "utf8");
const banner =
  "// AUTO-GENERATED. DO NOT EDIT MANUALLY. Edit mods/palserver-boss-reporter/Scripts/main.lua instead,\n" +
  "// then run `pnpm --filter @palserver/agent gen:boss-lua`.\n";
const body = `${banner}export const BOSS_REPORTER_LUA = ${JSON.stringify(lua)};\n`;
fs.writeFileSync(outPath, body);
console.log(`wrote ${path.relative(repoRoot, outPath)} (${lua.length} bytes of Lua)`);
