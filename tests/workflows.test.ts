import { expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { analyze, apply, open, prepare, serialize } from "../src/index.js";
import type { ProjectInput } from "../src/index.js";

const valid = "addrmap top { reg { field { sw = rw; hw = r; } f; } rr; };";
function capture(extra: Partial<ProjectInput> = {}) {
  const result = open({
    files: [{ id: "main", text: valid }],
    configurations: [{ id: "default", roots: ["main"] }],
    ...extra,
  });
  if (Result.isFailure(result)) throw new Error(result.failure.message);
  return result.success;
}

test("inactive malformed physical text does not block configured checked edits", async () => {
  const text = "`ifdef BROKEN\n??? malformed ???\n`else\n" + valid + "\n`endif\n";
  const snapshot = capture({ files: [{ id: "main", text }] });
  const candidate = await Effect.runPromise(
    prepare(snapshot, [], { mode: "configured", configurations: ["default"] }),
  );
  expect(candidate.reports[0]?.coverage.complete).toBe(true);
  expect(Result.isSuccess(apply(snapshot, candidate))).toBe(true);
  expect(serialize(snapshot)[0]?.text).toBe(text);
});

test("missing include remains saved and blocks checked acceptance", async () => {
  const text = '`include "missing.rdl"\n' + valid;
  const snapshot = capture({ files: [{ id: "main", text }] });
  const candidate = await Effect.runPromise(
    prepare(snapshot, [], { mode: "configured", configurations: ["default"] }),
  );
  expect(candidate.reports[0]?.coverage.complete).toBe(false);
  expect(Result.isFailure(apply(snapshot, candidate))).toBe(true);
  expect(Result.isSuccess(apply(snapshot, candidate, "draft"))).toBe(true);
  expect(serialize(snapshot)[0]?.text).toBe(text);
});

test("custom validation adds errors and never overrides standard errors", async () => {
  const snapshot = capture({
    files: [{ id: "main", text: valid.replace("sw = rw", "sw = nonsense") }],
    validators: [
      {
        id: "owner",
        version: "1",
        validate: (report) => {
          expect(Object.isFrozen(report)).toBe(true);
          return Result.succeed([
            {
              code: "owner.rule",
              severity: "error",
              phase: "custom",
              message: "Custom requirement.",
            },
          ]);
        },
      },
    ],
  });
  const report = await Effect.runPromise(analyze(snapshot, "default"));
  expect(report.diagnostics.some((d) => d.phase === "semantic" && d.severity === "error")).toBe(
    true,
  );
  expect(report.diagnostics.some((d) => d.code === "owner.rule" && d.origin === "owner")).toBe(
    true,
  );
});

test("validator failure becomes incomplete coverage while a thrown callback remains a defect", async () => {
  const snapshot = capture({
    validators: [
      { id: "offline", version: "1", validate: () => Result.fail({ message: "Cannot validate." }) },
    ],
  });
  const report = await Effect.runPromise(analyze(snapshot, "default"));
  expect(report.coverage.complete).toBe(false);
  expect(report.diagnostics.some((d) => d.code === "validator-failed")).toBe(true);
  const defective = capture({
    validators: [
      {
        id: "bug",
        version: "1",
        validate: () => {
          throw new Error("callback bug");
        },
      },
    ],
  });
  const exit = await Effect.runPromiseExit(Effect.result(analyze(defective, "default")));
  expect(exit._tag).toBe("Failure");
});

test("unknown configuration is an expected failure value", async () => {
  const result = await Effect.runPromise(Effect.result(analyze(capture(), "missing")));
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.code).toBe("unknown-configuration");
});
