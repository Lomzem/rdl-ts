import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { Effect, Result } from "effect";
import { analyze, open } from "../src/index.js";
import type { Instance } from "../src/index.js";

const python = process.env.RDL_REFERENCE_PYTHON ?? "python3";
for (const name of ["basic", "udp", "parameters", "arrays"]) {
  const file = `tests/fixtures/${name}.rdl`;
  const reference = spawnSync(python, ["scripts/reference.py", file], { encoding: "utf8" });
  if (reference.error) throw new Error(`Reference compiler failed: ${reference.error.message}`);
  if (reference.status !== 0) throw new Error(`Reference compiler failed: ${reference.stderr}`);
  const p = open({
    files: [{ id: "main", text: readFileSync(file, "utf8") }],
    configurations: [{ id: "main", roots: ["main"], top: "top" }],
  });
  if (Result.isFailure(p)) throw new Error(p.failure.message);
  const report = await Effect.runPromise(analyze(p.success, "main"));
  assert.equal(report.model, "complete", JSON.stringify(report.diagnostics));
  const records: Record<string, string>[] = [];
  const visit = (nodes: readonly Instance[]) => {
    for (const node of nodes) {
      const record: Record<string, string> = { path: node.path };
      if (node.address !== undefined) record.address = String(node.address);
      if (node.size !== undefined) record.size = String(node.size);
      if (node.lsb !== undefined) record.lsb = String(node.lsb);
      if (node.msb !== undefined) record.msb = String(node.msb);
      for (const prop of ["reset", "owner", "count"]) {
        const value = node.properties[prop]?.value;
        if (typeof value === "string") record[prop] = value;
        else if (value && typeof value === "object" && "kind" in value && value.kind === "integer")
          record[prop] = String(value.value);
      }
      records.push(record);
      visit(node.children);
    }
  };
  visit(report.roots);
  const expected = JSON.parse(reference.stdout) as Record<string, string>[];
  if (name === "arrays") {
    // SystemRDL 2.0 section 5.1.2.5 excludes trailing stride padding.
    // Keep both expectations explicit so a change on either side is investigated.
    const ours = records.find((record) => record.path === "top");
    const theirs = expected.find((record) => record.path === "top");
    assert.equal(ours?.size, "84", "Specification array span");
    assert.equal(theirs?.size, "96", "Pinned compiler trailing stride padding");
    assert.deepEqual(ours, { ...theirs, size: "84" });
    assert.deepEqual(
      records.filter((record) => record.path !== "top"),
      expected.filter((record) => record.path !== "top"),
      name,
    );
  } else {
    assert.deepEqual(records, expected, name);
  }
  console.log(`Compiler comparison passed: ${name}`);
}
