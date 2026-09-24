import { Effect, Result } from "effect";
import { analyze, apply, handle, open, prepare, serialize, source } from "../src/index.js";

export async function run() {
  const original =
    "// browser\r\naddrmap top { reg { field { reset = 8'h00; sw = rw; hw = r; } enabled[7:0]; } control; };\n";
  const opened = open({
    files: [{ id: "main", text: original }],
    configurations: [{ id: "main", roots: ["main"] }],
  });
  if (Result.isFailure(opened)) throw new Error(opened.failure.message);
  const snapshot = opened.success;
  const report = await Effect.runPromise(analyze(snapshot, "main"));
  if (report.model !== "complete") throw new Error(JSON.stringify(report.diagnostics));
  const root = source(snapshot).documents[0]!.nodes[0]!;
  const field = root.children?.[0]?.children?.[0];
  const reset = field?.children?.find((n) => n.name === "reset");
  if (!reset) throw new Error("Missing browser reset source target.");
  const target = handle(snapshot, reset);
  if (Result.isFailure(target)) throw new Error(target.failure.message);
  const candidate = await Effect.runPromise(
    prepare(
      snapshot,
      [{ kind: "replaceExpression", target: target.success, expression: "8'h01" }],
      { mode: "configured", configurations: ["main"] },
    ),
  );
  const applied = apply(snapshot, candidate);
  if (Result.isFailure(applied)) throw new Error(applied.failure.message);
  if (
    serialize(snapshot)[0]!.text !== original ||
    serialize(applied.success)[0]!.text !== original.replace("8'h00", "8'h01")
  )
    throw new Error("Browser source preservation failed.");
  return { roots: report.roots.length, passed: true };
}
