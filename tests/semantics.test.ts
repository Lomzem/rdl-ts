import { expect, test } from "bun:test";
import { analyzeInput } from "../src/semantics.js";
import { isDynamicallyAssignable } from "../src/properties.js";
import { integer } from "../src/expressions.js";
import type { ProjectInput } from "../src/types.js";
function analyze(text: string, extra: Partial<ProjectInput> = {}) {
  return analyzeInput(
    {
      files: [{ id: "main.rdl", text }],
      configurations: [{ id: "test", roots: ["main.rdl"] }],
      ...extra,
    },
    "revision",
    "test",
  );
}
function errors(text: string) {
  return analyze(text).diagnostics.filter((d) => d.severity === "error");
}
test("parameters specialize shared declarations and exact addresses", () => {
  const report = analyze(
    "reg word #(longint unsigned WIDTH=32) { regwidth=WIDTH; field {} bits[8]; }; addrmap top { word #(.WIDTH(64)) first @0x1000000000000000; word second; };",
  );
  expect(report.diagnostics).toEqual([]);
  const [first, second] = report.roots[0]!.children;
  expect(first!.size).toBe(8n);
  expect(second!.size).toBe(4n);
  expect(first!.address).toBe(0x1000000000000000n);
  expect(second!.address).toBe(0x1000000000000008n);
});
test("UDP defaults require binding and assignments enforce type", () => {
  const report = analyze(
    'property label {type=string;component=field;default="initial";}; addrmap top {reg {field {label;} bound; field {} plain;} ctrl;};',
  );
  expect(report.diagnostics).toEqual([]);
  const [bound, plain] = report.roots[0]!.children[0]!.children;
  expect(bound!.properties.label).toMatchObject({
    binding: "bound",
    state: "known",
    value: "initial",
    origin: "default",
  });
  expect(plain!.properties.label).toMatchObject({ binding: "unbound", state: "undefined" });
  expect(
    errors(
      "property label {type=string;component=field;}; addrmap top {reg {field {label=12;} f;} ctrl;};",
    ).some((d) => d.code === "property.type"),
  ).toBe(true);
});
test("UDP applicability width constraints and external duplicates", () => {
  expect(
    errors(
      "property p {type=bit;component=field;constraint=componentwidth;}; addrmap top {reg {field {p=8'hff;} f[4];} ctrl;};",
    ).some((d) => d.code === "udp.componentwidth"),
  ).toBe(true);
  expect(
    errors(
      "property p {type=boolean;component=field;}; addrmap top {p=true; reg {field {} f;} ctrl;};",
    ).some((d) => d.code === "property.component"),
  ).toBe(true);
  const report = analyze(
    "property p {type=boolean;component=field;}; addrmap top {reg {field {} f;} ctrl;};",
    { properties: [{ name: "p", type: "boolean", components: ["field"], origin: "caller" }] },
  );
  expect(report.diagnostics.some((d) => d.code === "udp.duplicate")).toBe(true);
});
test("dynamic assignments override lexical defaults and source assignments", () => {
  const report = analyze(
    "default reset=1; reg word { field {reset=2;} f[8]; }; addrmap top { word first; first.f->reset=3; word second; };",
  );
  expect(report.diagnostics).toEqual([]);
  expect(report.roots[0]!.children[0]!.children[0]!.properties.reset!.value).toEqual(integer(3n));
  expect(report.roots[0]!.children[1]!.children[0]!.properties.reset!.value).toEqual(integer(2n));
  expect(isDynamicallyAssignable("regwidth", "reg")).toBe(false);
  expect(isDynamicallyAssignable("reset", "field")).toBe(true);
});
test("arrays remain compact and contribute stride to allocation", () => {
  const report = analyze(
    "addrmap top { reg {field {} f;} words[1000000] += 8; reg {field {} f;} tail; };",
  );
  expect(report.diagnostics).toEqual([]);
  expect(report.roots[0]!.children).toHaveLength(2);
  expect(report.roots[0]!.children[0]!.dimensions).toEqual([1000000n]);
  expect(report.roots[0]!.children[1]!.address).toBe(7999996n);
});
test("invalid resets layout and static dynamic assignments are errors", () => {
  expect(
    errors(
      "addrmap top { reg {regwidth=24; field {reset=8'hff;} f[4];} ctrl;ctrl->regwidth=64;};",
    ).map((d) => d.code),
  ).toEqual(expect.arrayContaining(["register.width", "field.reset", "property.dynamic"]));
});
test("enums structs and array UDP values retain their types", () => {
  const report = analyze(
    "enum mode {idle=0;active=3;}; struct metadata {string label; boolean enabled;}; property m {type=mode;component=field;}; property info {type=metadata;component=field;}; property numbers {type=longint unsigned[];component=field;}; addrmap top {reg {field {m=mode::active;info=metadata'{label:\"ready\",enabled:true};numbers='{1,2};} f;} ctrl;};",
  );
  expect(report.diagnostics).toEqual([]);
  const props = report.roots[0]!.children[0]!.children[0]!.properties;
  expect(props.m!.value).toMatchObject({
    kind: "enum",
    type: "mode",
    member: "active",
    value: 3n,
    typeDefinition: { documentId: "main.rdl", start: 5, end: 9 },
  });
  expect(props.numbers!.value).toEqual([integer(1n), integer(2n)]);
});
test("absent fields leave position holes", () => {
  const report = analyze(
    "addrmap top { reg {field {} first[4];field {ispresent=false;} removed[4];field {} last[4];} ctrl;};",
  );
  expect(report.diagnostics).toEqual([]);
  expect(report.roots[0]!.children[0]!.children.map((c) => [c.name, c.lsb])).toEqual([
    ["first", 0n],
    ["last", 8n],
  ]);
});

test("property type and element namespaces remain independent", () => {
  const report = analyze(
    'property foo {component=field;type=string;};reg foo {field {foo="abc";} foo;};addrmap top {foo foo;foo.foo->foo="xyz";};',
  );
  expect(report.diagnostics).toEqual([]);
  expect(report.roots[0]!.children[0]!.children[0]!.properties.foo!.value).toBe("xyz");
});
test("signal references resolve through lexical scopes", () => {
  const report = analyze(
    "addrmap top {signal {} rst;reg {field {resetsignal=rst;reset=0;} f;} ctrl;};",
  );
  expect(report.diagnostics).toEqual([]);
});
test("msb0 field order allocates from the upper register bit", () => {
  const report = analyze("addrmap top {msb0;reg {field {} first[8];field {} second[4];} ctrl;};");
  expect(report.diagnostics).toEqual([]);
  expect(report.roots[0]!.children[0]!.children.map((c) => [c.lsb, c.msb])).toEqual([
    [31n, 24n],
    [23n, 20n],
  ]);
});

test("explicit first field infers address-map bit order", () => {
  const report = analyze("addrmap top {reg {field {} first[12:19];field {} second[4];} ctrl;};");
  expect(report.diagnostics).toEqual([]);
  expect(report.roots[0]!.properties.msb0!.value).toBe(true);
  expect(report.roots[0]!.children[0]!.children[1]).toMatchObject({ msb: 8n, lsb: 11n });
});
test("reference index records every hierarchy segment through trivia", () => {
  const text = "addrmap top {reg {field {} data;} ctrl;ctrl /* comment */ . data -> reset = 0;};";
  const report = analyze(text);
  expect(report.diagnostics).toEqual([]);
  const ctrl = report.references.filter((ref) => ref.name === "ctrl");
  expect(ctrl.some((ref) => text.slice(ref.range.start, ref.range.end) === "ctrl")).toBe(true);
  expect(
    report.references.some(
      (ref) => ref.name === "data" && text.slice(ref.range.start, ref.range.end) === "data",
    ),
  ).toBe(true);
});

test("repeated elaboration emits each physical reference once", () => {
  const text = "field F {}; reg W {F data;}; addrmap top {W first;W second;};";
  const report = analyze(text);
  expect(report.diagnostics).toEqual([]);
  const occurrence = text.indexOf("F data");
  expect(
    report.references.filter((reference) => reference.range.start === occurrence),
  ).toHaveLength(1);
  expect(new Set(report.references.map((reference) => JSON.stringify(reference))).size).toBe(
    report.references.length,
  );
});
test("deduplicating references preserves different include provenance", () => {
  const text =
    'field F {}; addrmap top {reg {\n`include "fields"\n} first;reg {\n`include "fields"\n} second;};';
  const report = analyze(text, {
    files: [
      { id: "main.rdl", text },
      { id: "fields", text: "F data;" },
    ],
    configurations: [
      {
        id: "test",
        roots: ["main.rdl"],
        includes: [{ from: "main.rdl", request: "fields", to: "fields" }],
      },
    ],
  });
  expect(report.diagnostics).toEqual([]);
  const references = report.references.filter(
    (reference) => reference.range.documentId === "fields" && reference.name === "F",
  );
  expect(references).toHaveLength(2);
  expect(references[0]!.provenance?.chain).not.toEqual(references[1]!.provenance?.chain);
});
test("configuration overrides have no invented source references or diagnostic positions", () => {
  const text = "enum E { A=0; }; addrmap top #(E MODE=E::A) {reg {field {} data;} ctrl;};";
  const report = analyze(text, {
    configurations: [{ id: "test", roots: ["main.rdl"], parameters: { MODE: "E::A" } }],
  });
  expect(report.diagnostics).toEqual([]);
  for (const reference of report.references)
    expect(text.slice(reference.range.start, reference.range.end)).toBe(reference.name);
  const numeric = "addrmap top #(longint COUNT=1) {reg {field {} data;} ctrl;};";
  for (const override of ["UNKNOWN", '"wrong type"']) {
    const invalid = analyze(numeric, {
      configurations: [{ id: "test", roots: ["main.rdl"], parameters: { COUNT: override } }],
    });
    expect(invalid.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of invalid.diagnostics) {
      expect(diagnostic.range).toBeUndefined();
      expect(diagnostic.provenance).toBeUndefined();
    }
  }
});
