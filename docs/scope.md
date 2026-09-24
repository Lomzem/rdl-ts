# Library scope

This document records confirmed scope and open questions from the design interview. It is not a completed specification.

## Confirmed

- Build a reusable TypeScript library for parsing and working with SystemRDL files. The GUI editor is a separate consumer project.
- The intended consumer is the author across personal projects. Prioritize those workflows; broad third-party adoption is not a design goal.
- The planning effort will produce an agreed first-release scope, acceptance examples, a glossary, and decision records where justified. Use a Wayfinder map if decisions require further sessions. Begin implementation after agreement on scope.
- Include source editing and semantic analysis in the intended scope. Source editing must be usable independently of successful semantic analysis. The accepted [first-release language boundary](./wayfinder/0004-language-boundary.md) records interpretation and deferral policies.
- Support UDP declarations, assignments, validation, and semantics within the supported language subset. Retaining arbitrary property names and values alone is insufficient.
- Support browser and Node.js use. The future GUI must be able to run entirely in the client browser. Callers supply source contents and resolve file dependencies.
- The library owns source preservation. Opening and saving without edits returns exactly the supplied source text. Value edits preserve text outside necessary edit locations. Structural edits preserve unaffected text and use a defined formatting policy for new text. The contract promises localized edits, not a mathematically smallest diff.
- The consumer expresses editing intent, including whether a change targets a shared definition or an individual instance. The library identifies the effects of supported edits.
- The accepted [source and editing model](./wayfinder/0005-source-editing.md) defines separate source/semantic views, refusal of unsupported instance-only transformations, and candidate freshness. Applying a candidate returns a new snapshot without changing the previous snapshot.
- Preserve documents containing unsupported constructs and report limitations. Analysis reports whether it is complete, partial, or unavailable, with reasons. Require enough information to fulfill each structured operation's stated promise. An exact source replacement and a complete reference-aware rename have different requirements.
- Exclude Perl execution. Preserve embedded Perl text, but refuse structured edits that require interpreting it.
- Use SystemRDL 2.0 as the authority for language rules. PeakRDL interoperability is a practical requirement because workplace projects use it to generate artifacts, but exporter restrictions do not define the library's language model.
- Defer the features identified in the accepted language-boundary decision. Preserve their source and report the unsupported feature rather than calling it invalid SystemRDL.
- Test language behavior primarily against specification-derived expectations. Use a limited, pinned set of PeakRDL/compiler interoperability checks in development and CI. Do not treat compiler output as the sole authority or automatically copy its deviations from the specification. Investigate and document discrepancies.
- Python tooling may run in development and CI. The shipped library must work in the browser without a Python runtime or server.
- Enforce standard UDP declaration, type, component applicability, binding, default, and assignment rules in the library. Consumers may add TypeScript validation for custom requirements. Arbitrary Python validators remain outside the browser library; consumers can run them through their toolchain. Exporter-specific validation is not a first-release requirement.
- Artifact generation, including RTL, documentation, and language bindings, belongs to separate consumers.
- Interpret SystemRDL-defined includes, macros, and conditional compilation with caller-supplied files and configuration. Preserve directives and inactive branches. Defer automatic structured editing of macro-generated declarations.
- First-release structured edits include built-in property and UDP assignments, UDP declarations, component and instance creation/deletion/duplication, address/field-position/parameter expressions, and renaming with updates to resolvable references. Defer moves between scopes or files.
- Support creating new SystemRDL documents through structured authoring operations, as well as editing existing documents. New content needs a default formatting style; preserving existing text remains required.
- Require explicit intent when replacing an expression versus changing a referenced definition. Do not infer that intent from a calculated value.
- Preserve malformed source, report errors with source locations, and recover structure where reliable. Refuse ambiguous targets and transformations whose stated promise cannot be established. Complete semantic analysis requires valid input.
- Accept caller-supplied UDP declarations as explicit analysis inputs. Saving must not silently insert those declarations into source documents.
- Accept ordered source files and explicit analysis configuration, including macros, top-level selection, and parameters. Analyze one configuration at a time; consumers may request several configurations over shared source documents.
- A rename must disclose unresolved references and incomplete coverage, including inactive conditional branches. Require explicit acceptance of a partial rename or sufficient configuration coverage to resolve the operation. Never present an incomplete rename as complete.
- Establish representative small and large project examples before setting performance promises. File counts, register counts, and array sizes remain unknown.
- Prepare candidate edits without changing the current document. Report text changes, diagnostics, and analysis completeness. Consumers may deliberately retain invalid drafts, with validation errors still reported as errors.
- Accepting a candidate with errors or incomplete validation requires an explicit consumer policy. A consumer may establish that policy for an editing session; a confirmation dialog for every edit is not required. Draft acceptance does not waive operation-specific requirements or permit ambiguous targets.
- Apply grouped edits entirely or leave the document unchanged. Validate the final candidate rather than requiring every intermediate step to be valid.
- Prefer errors as values rather than exception-based control flow. The accepted [public-interface decision](./wayfinder/0006-public-interface.md) specifies direct Effect use, Result for synchronous fallible operations, and ordinary document/report records. It also defines checked application by default with an explicit draft policy. Exact signatures and error variants remain to be designed.
- Exclude dedicated comment-authoring operations. Preserve existing comments as part of source preservation. Editing documentation through built-in properties such as `name` and `desc` is covered by property editing.
- Edit previews include changes to calculated addresses and field positions when analysis permits a reliable comparison. Report incomplete comparison otherwise. Never silently add explicit addresses to preserve the previous layout.
- Callers may mark source files read-only. Analysis may use those files. Applying a grouped edit that touches a read-only file fails as a value and changes no files. Do not silently redirect the edit elsewhere.

## Remaining research and planning

- The [design decision map](./wayfinder/0001-library-design.md) is complete. The reviewed [implementation design](./design.md) resolves delegated technical choices within the accepted scope.
- Initial dependency choices and the limited compiler verification pin are recorded in the design. Their runtime behavior still requires implementation tests; no exporter dependency defines language validity.
- Establish representative project sizes using synthetic fixtures initially. File counts, register counts, and array sizes for real projects remain unknown; do not claim performance guarantees without measurements.
- Refine the agreed behaviors in [acceptance examples](./acceptance.md) into executable fixtures during implementation.
- Follow the design's implementation sequence and early verification gates. Private algorithms may change without another scope interview when public guarantees remain intact.

## Compatibility research

PeakRDL uses `systemrdl-compiler` to interpret and elaborate SystemRDL. It also supports ordered input files sharing a namespace and selection of a top-level address map. These are analysis inputs to consider alongside included files. See [Processing Input](https://peakrdl.readthedocs.io/en/latest/processing-input.html).

The compiler's current documentation lists unsupported constraint blocks, heterogeneous instance-array assignments, and some nonconstant reference expressions. Full SystemRDL coverage and compatibility with this compiler are therefore distinct targets. First-release semantic coverage may defer these features without declaring them invalid under the standard. See [Known Issues & Limitations](https://systemrdl-compiler.readthedocs.io/en/stable/known_issues.html). These findings describe the documentation checked during planning, not a pinned compatibility baseline.
