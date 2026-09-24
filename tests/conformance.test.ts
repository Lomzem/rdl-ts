import { describe, expect, test } from "bun:test";
import { analyzeInput } from "../src/semantics.js";
import type { AnalysisReport, Instance, ProjectInput } from "../src/types.js";

function analyze(text: string, extra: Partial<ProjectInput> = {}): AnalysisReport {
  return analyzeInput(
    { files: [{ id: "main", text }], configurations: [{ id: "test", roots: ["main"] }], ...extra },
    "conformance",
    "test",
  );
}
function errors(report: AnalysisReport) {
  return report.diagnostics.filter((entry) => entry.severity === "error");
}
function all(instances: readonly Instance[]): Instance[] {
  return instances.flatMap((instance) => [instance, ...all(instance.children)]);
}
function find(report: AnalysisReport, name: string): Instance {
  return all(report.roots).find((instance) => instance.name === name)!;
}
const basic = "addrmap top { reg { field {} data; } ctrl; };";

// Each assertion exercises a semantic rule rather than the implementation's diagnostic wording.
describe("independent SystemRDL conformance fixtures", () => {
  test("5.1.4 permits identical names in type, element, and property namespaces", () => {
    const report = analyze(
      'property item {type=string;component=reg;}; reg item { item="metadata"; field {} data; }; addrmap top { item item; };',
    );
    expect(errors(report)).toEqual([]);
    expect(find(report, "item").properties.item?.value).toBe("metadata");
  });
  test("5.1.4 rejects use of a component type before its declaration", () => {
    expect(
      errors(analyze("addrmap top { later ctrl; reg later { field {} data; }; };")).length,
    ).toBeGreaterThan(0);
  });
  test("5.1.4 rejects a UDP assignment before its declaration", () => {
    expect(
      errors(
        analyze(
          "reg word { field { custom=1; } data; }; property custom {type=bit;component=field;}; addrmap top {word ctrl;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("5.1.4 resolves shadowed types at their lexical declaration scope", () => {
    const report = analyze(
      "reg word {regwidth=32;field {} data;}; regfile block {reg word {regwidth=64;field {} data;}; word inner;}; addrmap top {word outer;block nested;};",
    );
    expect(errors(report)).toEqual([]);
    expect(find(report, "outer").size).toBe(4n);
    expect(find(report, "inner").size).toBe(8n);
  });
  test("accepted compilation-unit policy isolates root defaults between inputs", () => {
    const report = analyze("", {
      files: [
        { id: "first", text: "default regwidth=64; reg wide {field {} data;};" },
        {
          id: "second",
          text: "reg plain {field {} data;}; addrmap top {wide first;plain second;};",
        },
      ],
      configurations: [{ id: "test", roots: ["first", "second"] }],
    });
    expect(errors(report)).toEqual([]);
    expect(find(report, "first").size).toBe(8n);
    expect(find(report, "second").size).toBe(4n);
  });
  test("5.2.1 uses the instance identifier as the implied name", () => {
    const report = analyze(basic);
    expect(errors(report)).toEqual([]);
    expect(find(report, "ctrl").properties.name?.value).toBe("ctrl");
  });
  test("5.2.2.1 allows disjoint donttest and dontcompare masks", () => {
    const report = analyze(
      "addrmap top { reg {field {donttest=8'h0f;dontcompare=8'hf0;} data[8];} ctrl;};",
    );
    expect(errors(report)).toEqual([]);
  });
  test("5.2.2.1 rejects a mask whose width differs from the field", () => {
    expect(
      errors(analyze("addrmap top {reg {field {donttest=4'h1;} data[8];} ctrl;};")).length,
    ).toBeGreaterThan(0);
  });
  test("5.1.2.4 rejects stride on scalar instances", () => {
    expect(
      errors(analyze("addrmap top {reg {field {} data;} ctrl += 8;};")).length,
    ).toBeGreaterThan(0);
  });
  test("5.1.2.4 rejects simultaneous fixed-address and alignment operators", () => {
    expect(
      errors(analyze("addrmap top {reg {field {} data;} ctrl @ 0 %= 8;};")).length,
    ).toBeGreaterThan(0);
  });
  test("6.3.1 allows empty default arrays in struct values", () => {
    const report = analyze(
      "struct metadata {longint unsigned values[];}; property info {type=metadata;component=field;}; addrmap top {reg {field {info=metadata'{};} data;} ctrl;};",
    );
    expect(errors(report)).toEqual([]);
    expect(find(report, "data").properties.info?.value).toMatchObject({
      kind: "struct",
      type: "metadata",
      typeDefinition: expect.objectContaining({ documentId: "main" }),
      members: { values: [] },
    });
  });
  test("6.3.2 rejects duplicate struct members", () => {
    expect(
      errors(
        analyze(
          'struct metadata {string label; string label;}; property info {type=metadata;component=field;}; addrmap top {reg {field {info=metadata\'{label:"x"};} data;} ctrl;};',
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("8 and 17.1 resolve global reset signal references", () => {
    const report = analyze(
      "signal {activelow;} rst; addrmap top {reg {field {reset=0;resetsignal=rst;} data;} ctrl;};",
    );
    expect(errors(report)).toEqual([]);
    expect(find(report, "data").properties.resetsignal?.value).toEqual({
      kind: "reference",
      path: "rst",
    });
  });
  test("9 property targets preserve hardware-reference identity", () => {
    const report = analyze(
      "addrmap top {reg {field {anded;} source[8];field {} sink;sink->next=source->anded;} ctrl;};",
    );
    expect(errors(report)).toEqual([]);
    expect(find(report, "sink").properties.next?.value).toEqual({
      kind: "reference",
      path: "top.ctrl.source",
      property: "anded",
    });
  });
  test("10.5 allows alias types with matching named fields and positions", () => {
    const report = analyze(
      "reg primary_type {field {} data[8];}; reg alias_type {field {sw=r;} data[8];}; addrmap top {primary_type primary;alias primary alias_type alternate_ctrl;};",
    );
    expect(errors(report)).toEqual([]);
    expect(find(report, "alternate_ctrl").alias).toBe("primary");
  });
  test("10.5 rejects aliases whose fields have different names", () => {
    expect(
      errors(
        analyze(
          "reg primary_type {field {} data[8];}; reg alias_type {field {} other[8];}; addrmap top {primary_type primary;alias primary alias_type alternate_ctrl;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("10.5 rejects aliases whose matching fields have different positions", () => {
    expect(
      errors(
        analyze(
          "reg primary_type {field {} data[7:0];}; reg alias_type {field {} data[15:8];}; addrmap top {primary_type primary;alias primary alias_type alternate_ctrl;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("11.2 rejects memory instances without external storage", () => {
    expect(
      errors(analyze("addrmap top {mem {memwidth=32;mementries=4;} ram;};")).length,
    ).toBeGreaterThan(0);
  });
  test("11.2 places virtual registers inside an external memory", () => {
    const report = analyze(
      "addrmap top {external mem {memwidth=32;mementries=4;reg {field {} data[32];} entry @ 8;} ram @ 0x100;};",
    );
    expect(errors(report)).toEqual([]);
    expect(find(report, "ram").size).toBe(16n);
    expect(find(report, "entry").address).toBe(0x108n);
  });
  test("11.2 rejects virtual fields extending beyond memory width", () => {
    expect(
      errors(
        analyze(
          "addrmap top {external mem {memwidth=24;mementries=4;reg {field {} data[32];} entry;} ram;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("15.1 rejects signal as a UDP value type while allowing signal applicability", () => {
    expect(
      errors(analyze("property link {type=signal;component=field;};" + basic)).length,
    ).toBeGreaterThan(0);
    const valid = analyze(
      'property label {type=string;component=signal;}; addrmap top {signal {label="reset";} rst;reg {field {} data;} ctrl;};',
    );
    expect(errors(valid)).toEqual([]);
  });
  test("15.1 rejects reserved enums as UDP declaration types", () => {
    expect(
      errors(analyze("property access {type=accesstype;component=field;};" + basic)).length,
    ).toBeGreaterThan(0);
  });
  test("15.2 requires a named enumerator of the UDP's exact enum type", () => {
    expect(
      errors(
        analyze(
          "enum mode {idle=0;}; property p {type=mode;component=field;};addrmap top {reg {field {p=0;} data;} ctrl;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      errors(
        analyze(
          "enum mode {idle=0;};enum other {idle=0;};property p {type=mode;component=field;};addrmap top {reg {field {p=other::idle;} data;} ctrl;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("15.2 type-checks every element of UDP arrays", () => {
    expect(
      errors(
        analyze(
          'property labels {type=string[];component=field;};addrmap top {reg {field {labels=\'{"valid",7};} data;} ctrl;};',
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("6.3.2 allows assignment of a derived struct to a concrete base type", () => {
    const report = analyze(
      'struct base {string label;}; struct derived : base {boolean active;}; property info {type=base;component=field;}; addrmap top {reg {field {info=derived\'{label:"x",active:true};} data;} ctrl;};',
    );
    expect(errors(report)).toEqual([]);
    expect(find(report, "data").properties.info?.value).toMatchObject({
      kind: "struct",
      type: "derived",
      typeDefinition: expect.objectContaining({ documentId: "main" }),
      members: { label: "x", active: true },
    });
  });
  test("6.2.5 rejects duplicate enumerator values even when implicit", () => {
    expect(
      errors(
        analyze(
          "enum mode {first=1;second=0;third;}; property p {type=mode;component=field;};addrmap top {reg {field {p=mode::third;} data;} ctrl;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("8.2 treats signals with neither sync nor async set as synchronous", () => {
    const report = analyze("addrmap top {signal {} ready;reg {field {} data;} ctrl;};");
    expect(errors(report)).toEqual([]);
    expect(find(report, "ready").properties.sync?.value).toBe(true);
  });
  test("8.3 rejects an instance width differing from its predefined signalwidth", () => {
    expect(
      errors(
        analyze(
          "addrmap top {signal sig {signalwidth=8;};sig ready[4];reg {field {} data;} ctrl;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("5.1.4 rejects duplicate dynamic assignments in one scope", () => {
    expect(
      errors(
        analyze(
          "addrmap top {reg {field {} data[8];} ctrl;ctrl.data->reset=1;ctrl.data->reset=2;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("15.1 validates reference element kinds in struct-valued UDPs", () => {
    expect(
      errors(
        analyze(
          "struct metadata {field target;};property info {type=metadata;component=field;};addrmap top {reg {field {} data;} ctrl;ctrl.data->info=metadata'{target:ctrl};};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("15.1 supports arrays of typed component references", () => {
    const report = analyze(
      "property peers {type=field[];component=reg;};addrmap top {reg {field {} first;field {} second;} ctrl;ctrl->peers='{ctrl.first,ctrl.second};};",
    );
    expect(errors(report)).toEqual([]);
    expect(find(report, "ctrl").properties.peers?.value).toEqual([
      { kind: "reference", path: "top.ctrl.first" },
      { kind: "reference", path: "top.ctrl.second" },
    ]);
  });
  test("8.3.2 supports reset values supplied by matching-width signals", () => {
    const report = analyze(
      "addrmap top {reg {field {} data[8]=0;} ctrl;signal {signalwidth=8;} reset_value[8];ctrl.data->reset=reset_value;};",
    );
    expect(errors(report)).toEqual([]);
    expect(find(report, "data").properties.reset?.value).toEqual({
      kind: "reference",
      path: "top.reset_value",
    });
  });
  test("deferred runtime-dependent references make coverage incomplete", () => {
    const report = analyze(
      "addrmap top {signal {} select;reg {field {} left;field {} right;field {} target;} ctrl;ctrl.target->next=select ? ctrl.left : ctrl.right;};",
    );
    expect(report.coverage.complete).toBe(false);
    expect(report.diagnostics.some((entry) => entry.code.startsWith("unsupported."))).toBe(true);
  });
  test("6.2.6 rejects references to out-of-bounds instance-array elements", () => {
    expect(
      errors(
        analyze(
          "property target {type=field;component=addrmap;};addrmap top {reg {field {} data;} bank[2];target=bank[9].data;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("6.2.5 keeps shadowed enum types distinct even when member names and values match", () => {
    expect(
      errors(
        analyze(
          "enum mode {idle=0;};property value {type=mode;component=field;};addrmap top {enum mode {idle=0;};reg {field {value=mode::idle;} data;} ctrl;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("Annex B.14 accepts implicit unsigned longint parameter types", () => {
    const report = analyze(
      "reg word #(longint WIDTH=32) {regwidth=WIDTH;field {} data;};addrmap top{word ctrl;};",
    );
    expect(errors(report)).toEqual([]);
    expect(find(report, "ctrl").size).toBe(4n);
  });
  test("5.1.4 rejects dynamic references to elements declared later", () => {
    expect(
      errors(analyze("addrmap top{reg{field{}first;first->next=later;field{}later;}ctrl;};"))
        .length,
    ).toBeGreaterThan(0);
  });
  test("unused component definitions still validate literal property types", () => {
    expect(
      errors(
        analyze(
          'reg unused {field {reset="bad";} data;};addrmap top {reg {field {} data;} ctrl;};',
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("7.1 follows SystemVerilog left associativity for exponentiation", () => {
    const report = analyze("addrmap top {reg {field {reset=2 ** 3 ** 2;} data[16];} ctrl;};");
    expect(errors(report)).toEqual([]);
    expect(find(report, "data").properties.reset?.value).toMatchObject({
      kind: "integer",
      value: 64n,
    });
  });
  test("10.5.1 rejects differing reset properties on corresponding alias fields", () => {
    expect(
      errors(
        analyze(
          "reg primary_type{field{reset=0;}data;};reg alias_type{field{reset=1;}data;};addrmap top{primary_type primary;alias primary alias_type mirror;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("10.5.1 requires explicitly chosen alias storage to match its primary", () => {
    expect(
      errors(
        analyze(
          "reg word{field{}data;};addrmap top{external word primary;internal alias primary word mirror;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("11.2 rejects virtual-field software access inconsistent with the memory", () => {
    expect(
      errors(
        analyze(
          "addrmap top{external mem{memwidth=32;mementries=1;sw=r;reg{field{sw=rw;}data[32];}entry;}ram;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("11.2 rejects overlapping virtual registers", () => {
    expect(
      errors(
        analyze(
          "addrmap top{external mem{memwidth=32;mementries=4;reg{field{}data[32];}first@0;reg{field{}data[32];}second@0;}ram;};",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  test("11.2 inherits memory software access for virtual fields without an override", () => {
    const report = analyze(
      "addrmap top{external mem{memwidth=32;mementries=1;sw=r;reg{field{}data[32];}entry;}ram;};",
    );
    expect(errors(report)).toEqual([]);
    expect(find(report, "data").properties.sw?.value).toMatchObject({
      kind: "enum",
      type: "accesstype",
      member: "r",
    });
  });
});

test("reference index distinguishes enum types from identically named members", () => {
  const text =
    "enum mode {mode=0;}; property p {type=mode;component=field;}; addrmap top {reg {field {p=mode::mode;} data;} ctrl;};";
  const report = analyze(text);
  expect(errors(report)).toEqual([]);
  const typeStart = text.indexOf("mode");
  const memberStart = text.indexOf("mode=0");
  const useStart = text.indexOf("mode::mode");
  const typeReferences = report.references.filter((ref) => ref.definition.start === typeStart);
  expect(typeReferences.some((ref) => ref.range.start === useStart)).toBe(true);
  expect(typeReferences.some((ref) => ref.range.start === useStart + 6)).toBe(false);
  expect(
    report.references.some(
      (ref) => ref.definition.start === memberStart && ref.range.start === useStart + 6,
    ),
  ).toBe(true);
});

test("reference index includes members selected through an instance array", () => {
  const text =
    "property refs {type=ref;component=reg;}; addrmap top {reg {field {} data;} ctrl[2]; reg {refs=ctrl[0].data;field {} value;} output;};";
  const report = analyze(text);
  expect(errors(report)).toEqual([]);
  const declaration = text.indexOf("data;");
  const use = text.indexOf(".data") + 1;
  expect(
    report.references.some(
      (ref) =>
        ref.definition.start === declaration &&
        ref.range.start === use &&
        ref.range.end === use + 4,
    ),
  ).toBe(true);
});

test("reference indexing never treats comment text as an identifier use", () => {
  const text =
    "enum mode {idle=0;}; property p {type=mode;component=field;}; addrmap top {reg {field {p=/*mode*/ mode::idle;} data;} ctrl;};";
  const report = analyze(text);
  expect(errors(report)).toEqual([]);
  const comment = text.indexOf("/*mode*/");
  expect(
    report.references.some((ref) => ref.range.start >= comment && ref.range.end <= comment + 8),
  ).toBe(false);
});
