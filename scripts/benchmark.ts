import { Effect, Result } from "effect";
import { analyze, open } from "../src/index.js";

// Synthetic examples establish workload shapes, not performance promises.
for (const count of [20, 1000]) {
  const text = `reg word { field { sw=rw; hw=r; } value[31:0]; };\naddrmap top {\n${Array.from({ length: count }, (_, i) => `word r${i};`).join("\n")}\n};\n`;
  const started = performance.now();
  const opened = open({
    files: [{ id: "main", text }],
    configurations: [{ id: "main", roots: ["main"] }],
  });
  if (Result.isFailure(opened)) throw new Error(opened.failure.message);
  const parsed = performance.now();
  const report = await Effect.runPromise(analyze(opened.success, "main"));
  if (report.model !== "complete" || !report.coverage.complete)
    throw new Error(JSON.stringify(report.diagnostics));
  console.log(
    JSON.stringify({
      registers: count,
      sourceCharacters: text.length,
      openMilliseconds: +(parsed - started).toFixed(1),
      analyzeMilliseconds: +(performance.now() - parsed).toFixed(1),
    }),
  );
}
