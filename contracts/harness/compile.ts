/** Compile ../src/*.sol with solc-js (standard JSON) → build.json {name: {abi, bytecode}} */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// @ts-expect-error solc has no types
import solc from "solc";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

const sources: Record<string, { content: string }> = {};
for (const f of readdirSync(srcDir).filter((f) => f.endsWith(".sol"))) {
  sources[f] = { content: readFileSync(join(srcDir, f), "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris", // max VM compatibility (no PUSH0/MCOPY); revisit at deploy time
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

function importResolver(path: string): { contents: string } | { error: string } {
  const name = path.replace(/^\.\//, "");
  if (sources[name]) return { contents: sources[name].content };
  return { error: `import not found: ${path}` };
}

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: importResolver }));

const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
for (const e of (out.errors ?? []).filter((e: { severity: string }) => e.severity === "warning")) {
  console.error("warn:", e.formattedMessage?.split("\n")[0]);
}

const build: Record<string, { abi: unknown; bytecode: string }> = {};
for (const file of Object.keys(out.contracts ?? {})) {
  for (const name of Object.keys(out.contracts[file])) {
    const c = out.contracts[file][name];
    build[name] = { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
  }
}
writeFileSync(join(here, "build.json"), JSON.stringify(build));
console.log(`compiled ${Object.keys(build).length} contracts → build.json`);
