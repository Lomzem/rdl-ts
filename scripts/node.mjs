import assert from "node:assert/strict";
import { Effect, Result } from "effect";
import { analyze, apply, handle, open, prepare, serialize, source } from "../dist/index.js";

const text = "addrmap top { reg { field { reset=0; } data; } control; };\n";
const opened = open({
  files: [{ id: "main", text }],
  configurations: [{ id: "main", roots: ["main"] }],
});
assert.ok(Result.isSuccess(opened));
const snapshot = opened.success;
const report = await Effect.runPromise(analyze(snapshot, "main"));
assert.equal(report.model, "complete");
assert.equal(report.coverage.complete, true);
const root = source(snapshot).documents[0].nodes[0];
const selected = handle(snapshot, root);
assert.ok(Result.isSuccess(selected));
const candidate = await Effect.runPromise(
  prepare(
    snapshot,
    [
      {
        kind: "setProperty",
        target: selected.success,
        property: "desc",
        expression: '"Node test"',
      },
    ],
    { mode: "configured", configurations: ["main"] },
  ),
);
const applied = apply(snapshot, candidate);
assert.ok(Result.isSuccess(applied));
assert.equal(serialize(snapshot)[0].text, text);
assert.match(serialize(applied.success)[0].text, /desc = "Node test";/);
console.log(`Built ESM package open/analyze/edit/save passed on Node ${process.version}.`);
