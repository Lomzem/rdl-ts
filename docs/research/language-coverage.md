# Language coverage research

Research date: 2026-09-23. This document preserves the research and its original proposals, not an implemented feature list. The later [language-boundary resolution](../wayfinder/0004-language-boundary.md) records which policies the user accepted.

## Authority and evidence

SystemRDL 2.0 defines validity and meaning. References below identify clauses in the local, intentionally untracked `read-only/systemrdl-2.0-spec.txt`. The specification is not copied into this report.

The proposed interoperability pin is **systemrdl-compiler 1.32.2**, published on 2026-02-27. Both [PyPI release metadata](https://pypi.org/pypi/systemrdl-compiler/json) and the [upstream release](https://github.com/SystemRDL/systemrdl-compiler/releases/tag/v1.32.2) identify that version as current when checked. This is a development dependency proposal. It does not require PeakRDL exporters or Python in the browser library.

Context7's library lookup returned unrelated compiler projects. Research therefore used the local specification, official compiler documentation, and [the tagged 1.32.2 grammar](https://github.com/SystemRDL/systemrdl-compiler/blob/v1.32.2/src/systemrdl/parser/SystemRDL.g4). No compiler fixtures were executed. Grammar inspection establishes syntax recognition, not successful elaboration. The mutable `stable` documentation may describe behavior beyond the pinned release.

## Reading the matrix

- **In scope** translates the agreed language target into concrete coverage. It is not a claim that code exists.
- **Proposed deferral** identifies a concrete application of the accepted policy to defer compiler-unsupported features. The exact boundary still needs review.
- **Excluded** records an accepted exclusion.
- **Decision needed** identifies contradictory or insufficient specification text.

All statuses retain original source text. An unsupported construct produces a limitation diagnostic and reduces analysis completeness where relevant. It must not become a standard-validity error merely because implementation is deferred.

## Feature matrix

| Feature                               | Proposed first-release treatment                                                                                                                 | Specification reference and qualification                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Lexical forms                         | In scope. Preserve trivia, escaped identifiers, spelling of strings and numeric literals.                                                        | Clause 4. Source preservation additionally follows the project contract.                              |
| Named and anonymous definitions       | In scope. Separate reusable definitions from instances.                                                                                          | 5.1.1, 5.1.2. Preserve declaration order and nesting.                                                 |
| Components                            | In scope. `addrmap`, `regfile`, `reg`, `field`, `mem`, and `signal`.                                                                             | Clauses 8 to 13. Enforce legal containment, widths, and instance forms.                               |
| Internal and external components      | In scope. Retain and validate access boundaries.                                                                                                 | 5.1.2, 10.3, 10.4, 11.1 to 11.2. No hardware generation implied.                                      |
| Alias registers                       | In scope. Model the primary register relationship and validate alias restrictions.                                                               | 10.5. Exporter support does not determine validity.                                                   |
| Memories and virtual registers        | In scope. Model memory size, width, access, and permitted virtual contents.                                                                      | Clause 11. Do not model memory merely as repeated ordinary registers.                                 |
| Bridges and multiple views            | In scope. Preserve properties and enforce component relationships.                                                                               | 13.5. Do not infer an exporter's bus-interface implementation.                                        |
| Instance arrays                       | In scope. Dimensions, indexing, array stride, and common definition.                                                                             | 5.1.2, component-specific clauses. Distinct from arrays used as values.                               |
| Per-element array overrides           | Proposed deferral of semantic support. Whole-array assignment stays in scope.                                                                    | 5.1.3.3 permits element assignments. Compiler documents a limitation here.                            |
| Parameters                            | In scope. Declaration types, defaults, named overrides, dependencies, and specialization.                                                        | 5.1.1.1 to 5.1.1.4. Parameters cannot carry component references.                                     |
| Names and references                  | In scope. Lexical namespaces, declaration-before-use, hierarchical references, and shadowing.                                                    | 5.1.4, 6.2.6. Source identity and instance identity remain distinct.                                  |
| Static/default/dynamic assignments    | In scope. Validate assignability, precedence, duplicates, and enclosing-scope overrides. Not every property allows a dynamic override.           | 5.1.3, 5.1.4. Defaults follow lexical scope.                                                          |
| Built-in properties                   | In scope. Types, applicability, exclusivity, dependencies, dynamic-assignment permissions, and effective values.                                 | Clauses 5, 8 to 14, normative rules prevail over informative Annex G.                                 |
| Field behavior properties             | In scope. Access, reset, hardware references, counters, interrupts, and precedence metadata.                                                     | Clause 9, 10.8, 17.1 to 17.2. Describe and validate behavior without simulating hardware.             |
| Signals                               | In scope. Width, polarity, reset roles, and references.                                                                                          | Clause 8, 17.1. Unspecified polarity requires care when the signal controls reset.                    |
| Property-reference targets            | In scope where the reference can be established during elaboration.                                                                              | Clause 9, Annex G. Some references describe hardware signals, not a copy of an assigned value.        |
| Runtime-dependent reference selection | Proposed deferral. Preserve the expression and report incomplete semantics.                                                                      | Compiler limitation applies when elaboration cannot determine the assigned reference.                 |
| Integral values                       | In scope. Exact unsigned values, sized bits, 64-bit `longint unsigned`, overflow and casts.                                                      | 4.6, 6.2.1, 6.4 to 6.5, 7.3. JavaScript `number` cannot represent every valid value.                  |
| Expressions                           | In scope. Arithmetic, comparisons, shifts, reductions, logical operators, conditionals, concatenation and replication.                           | Clause 7, Annex B. Follow type and width rules rather than JavaScript operator semantics.             |
| String expressions                    | In scope. UTF-8 content, equality, concatenation, and replication.                                                                               | 4.5, 6.2.2. Preserve raw source spelling separately from decoded values.                              |
| Reserved enumerations                 | In scope in the contexts the standard permits.                                                                                                   | 6.2.4, Table 7. These have no associated integral values. Concatenation ambiguity is discussed below. |
| User enumerations                     | In scope. Scoped names, explicit and automatic values, documentation, and `encode`.                                                              | 6.2.5, 9.4. Numeric equality alone does not make values from different enum types interchangeable.    |
| Structs                               | In scope. Abstract structs, inheritance, typed members, literals, access, and allowed references.                                                | 6.3.2. Component construction is separate from struct values.                                         |
| Value arrays                          | In scope. Homogeneous one-dimensional arrays, literals, indexing, and replacement. Empty-literal syntax needs the interpretation decision below. | 6.3.1. Direct arrays of arrays are not standard-valid. Arrays of structs may contain array members.   |
| Address allocation                    | In scope. Explicit offsets, inferred placement, stride, alignment, addressing modes, and overlap validation.                                     | 5.1.2, 10.7, 12 to 13. Address previews compare elaborated results.                                   |
| Field placement                       | In scope. Width/range forms, inferred positions, overlap rules, and bit ordering.                                                                | 9.1 to 9.3, 17.3. Field ranges are not ordinary instance-array dimensions.                            |
| UDP declarations and values           | In scope with the complete permitted type family and standard rules below.                                                                       | Clause 15, 6.4. This cannot be reduced to arbitrary JSON attributes.                                  |
| External UDP declarations             | In scope as explicit caller inputs, with their origin retained.                                                                                  | Agreed application capability. Source alone may need matching declarations in another tool.           |
| HDL path properties                   | In scope as typed source properties. Preserve strings and arrays.                                                                                | 14.1. Resolving paths against an HDL design is outside this library's scope.                          |
| Constraint blocks                     | Proposed deferral of semantics, including constraint components and their dependent assignments.                                                 | 14.2. Compiler documents no implementation. UDP `componentwidth` remains in scope.                    |
| `name`, `desc`, documentation strings | In scope as language values and editable properties.                                                                                             | 5.2.1, informative Annex F. Rendering RDLFormatCode to HTML belongs to a consumer.                    |
| Includes and macros                   | In scope. Caller-provided files, macro expansion, conditional branches, and origin tracking.                                                     | 16.2. Include nesting must permit at least 15 levels.                                                 |
| Standard preprocessing directives     | In scope for defined directives, subject to the unresolved `if` entry below.                                                                     | Table 32 includes `define`, `else`, `elsif`, `endif`, `ifdef`, `ifndef`, `include`, `line`, `undef`.  |
| Other Verilog directives              | Retain original text and implement the standard's removal during preprocessing.                                                                  | 16.2.1 does not make arbitrary Verilog/SystemVerilog syntax valid.                                    |
| Embedded Perl                         | Excluded execution. Preserve text and restrict dependent analysis and edits.                                                                     | 16.1. Accepted project boundary.                                                                      |
| Macro-generated declaration editing   | Deferred structured transformations. Preserve macro definitions and invocations.                                                                 | Accepted editing boundary. Expansion provenance must remain available.                                |
| Multiple root input files             | In scope. Exact compilation-unit behavior needs a documented policy.                                                                             | 5.1.4 covers scopes, but does not define a multiple-file compilation API.                             |
| Deprecated language content           | Recognize and diagnose the standard's deprecated forms without silently rewriting them.                                                          | 5.3 and Annex C. Supporting 1.0 as a separate language is not proposed.                               |

## UDP details that must survive API design

Clause 15.1, Tables 30 to 31, permits `number`, `bit`, `longint unsigned`, `string`, `boolean`, named enumeration types, struct types, `ref`, specific `addrmap`/`regfile`/`reg`/`mem`/`field` reference types, and single-dimensional arrays of permitted non-array types. `number` is the backward-compatible spelling for a bit value. A UDP's allowed component kinds are a separate attribute from its value type.

The following checks belong to the library, including for caller-supplied declarations:

1. Require `type` and `component`, validate their contents, and define UDPs in root scope.
2. Check assignment compatibility and component applicability on every binding and assignment.
3. Enforce named membership for enumeration assignments, not merely an equal integer value.
4. Validate default values against the declared type. A reference default cannot point at an instance of a parameterized type.
5. Validate field-value width rules and the legal `componentwidth` constraint. Table 30 limits that constraint to `bit`; it is not a general-purpose predicate or a constraint block.
6. Preserve the distinction between declaration, binding, and assignment. A UDP declaration alone does not bind that UDP to every applicable component.
7. Resolve binding without an explicit value using the declared default when present. Otherwise retain the undefined value state shown in 15.2.2. Do not silently coerce it to `false`, zero, or an empty string.
8. Apply the permitted static/default/dynamic assignment rules, including precedence and duplicate assignments, rather than storing only a final dictionary.

A useful test has four fields: an unbound UDP, a bare binding without a declared default, a bare binding with a declared default, and an explicit assignment. Consumers need to distinguish all four origins even where resulting values coincide.

The compiler also has optional [Python UDP registration and validation](https://systemrdl-compiler.readthedocs.io/en/stable/api/udp.html). Its callback-provided unassigned default is a query convenience, not standard UDP binding. Do not copy that behavior into standard semantic results. TypeScript custom validation can add diagnostics after standard validation.

`component = signal` is legal applicability. Table 31 and Annex B do not offer `type = signal` as a UDP value type. Struct member types have different rules. These distinctions should not disappear behind one generic reference type.

## Concrete differences and unresolved readings

The compiler's [documented limitations](https://systemrdl-compiler.readthedocs.io/en/stable/known_issues.html) identify constraint blocks, indexed instance-array dynamic assignments, and reference selections that depend on runtime values. These are the three proposed semantic deferrals above. Whole-array assignments and ordinary signal references must remain supported. Verify each limitation against the pin before making an executable compatibility claim.

The following require explicit interpretations, rather than treating all compiler behavior as authoritative:

| Question                               | Evidence and proposed next step                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Undefined preprocessor `if`            | Table 32 names it but supplies no semantics. The compiler omits it. Propose an unsupported-directive diagnostic while retaining the source. Support the defined conditional directives.                                                                                                                                           |
| Empty arrays                           | 6.3.1 explicitly permits an empty literal, but Annex B requires an element and section 1 gives the grammar precedence. The tagged compiler accepts empty literals. Propose accepting them as a documented errata/interoperability interpretation requiring approval, not as the literal result of the standard's precedence rule. |
| Reserved-enum concatenation            | Table 9 lists reserved enums as concatenation operands, while 6.2.4 gives them no integral values and allows only equality. Do not invent a numeric encoding. Investigate and record a diagnostic policy before claiming this case works.                                                                                         |
| UDP binding defaults                   | Chapter 15 distinguishes binding from built-in boolean shorthand. Test bare UDP bindings and absent defaults independently of the usual bare-boolean assignment rule in 5.1.3.                                                                                                                                                    |
| Reference type contexts                | Table 7's broad `ref` description does not override the narrower parameter, struct, and UDP productions. Use the specific rules and reject invented extensions.                                                                                                                                                                   |
| Compilation units                      | Propose shared root declarations across ordered inputs, with macros and root defaults scoped to each input plus its includes. This is a compatibility policy, not a rule supplied by 5.1.4.                                                                                                                                       |
| Generated type names                   | 5.1.1.4 specifies parameter-based names. Dynamic-override naming is less complete. Stable application identity should not depend on matching compiler-generated strings.                                                                                                                                                          |
| Summary tables versus semantic clauses | 5.2.2.1 permits combinations of verification properties that Annex G's exclusivity summary oversimplifies. Prefer the normative clause. Do not copy every example into a positive fixture without checking its rules.                                                                                                             |

The upstream [errata notes](https://systemrdl-compiler.readthedocs.io/en/stable/dev_notes/rdl_spec_errata.html) document the compiler author's interpretations, not an Accellera amendment. They confirm the undefined directive, empty-array contradiction, narrower reference contexts, and absent compilation-unit semantics. They also flag reset polarity, HDL slice ambiguity, and a byte-order example error. Review those clauses before implementing those behaviors. Text rendering opinions and exporter workarounds do not automatically change our language rules.

For compilation units, [upstream's multi-file policy](https://systemrdl-compiler.readthedocs.io/en/stable/dev_notes/multi_file_compilation.html) shares root declaration namespaces but resets macro and root-default state at input-file boundaries. Included files remain part of the including unit. That is the concrete policy proposed above for user review.

## Small interoperability suite

The main test suite should derive expectations from cited specification clauses, including negative cases. A small, pinned compiler comparison adds evidence without defining correctness.

Start with these independent fixture families:

1. Basic hierarchy, register arrays, explicit and inferred addresses, and field positions.
2. Parameter specialization, lexical defaults, and dynamic override precedence.
3. Exact integral values above JavaScript's safe-integer range, width propagation, casts, concatenation, and overflow.
4. UDP scalar, enum, struct, array, and reference values, plus binding/default distinctions and rejected assignments.
5. Includes, macro arguments, conditional configurations, and multiple-file namespace/default isolation.
6. Alias registers, memories with virtual registers, and ordinary signal/property references.
7. A source edit followed by compilation that preserves expected values and reports intended layout changes.

Compare a small normalized result: paths, component kinds, array dimensions, addresses, field positions, effective property values, and reference targets. Keep source-preservation assertions entirely independent of the Python compiler. Normalize expected errors by category; matching compiler message text is unnecessary.

Every discrepancy should retain its fixture, specification citation, compiler version, expected standard result, and observed result. An explicit discrepancy is more useful than changing a standard-derived expectation just to obtain agreement. Do not add exporters to this suite unless a specific consumer issue warrants a separate check.

## Decisions to take next

Review the proposed semantic deferrals and the contradictory language cases with the user. The immediate policy choices are compilation-unit boundaries, unsupported `if`, empty-array literal syntax, and reserved-enum concatenation. An instance-only edit must return a failure if the intended property cannot be overridden through a supported operation. Automatically cloning its shared definition would be a separate transformation and is not proposed. UDP binding and exact unsigned arithmetic are implementation requirements derived from the standard, not optional product features.

This report does not claim complete conformance, compiler-equivalent validation, executable tests, measured performance, or an implemented API.
