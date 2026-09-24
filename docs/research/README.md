# Research and design proposals

The research answers factual questions raised by the scope interview. The [language-boundary resolution](../wayfinder/0004-language-boundary.md) and [source/editing resolution](../wayfinder/0005-source-editing.md) record accepted policies. Public-interface details remain proposals. No library implementation, conformance suite, or performance measurements exist yet.

## Read first

| Document                                                               | What it provides                                                                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Language coverage research](./language-coverage.md)                   | Feature matrix, UDP requirements, proposed compiler pin and deferrals, and concrete specification ambiguities.                                       |
| [Proposed source and editing interface](./source-editing-interface.md) | Opening, inspecting, creating, editing, validating, applying, and serializing documents; source targets and semantic views; candidate record sketch. |
| [Errors-as-values interface research](./error-interface.md)            | Verified Effect 4 behavior and comparison with ordinary TypeScript result values.                                                                    |

## Recommendations

Use the original source as the saved representation and derive semantic views for each explicit configuration. Separate shared declarations from elaborated instances. Revision-bound candidates preserve text and make grouped application explicit. Validate candidates against the included files and external declarations as well as the main document.

Use plain document/report records, Result for synchronous fallible operations, and Effect for workflows that benefit from dependency resolution or cancellation. This is one proposed interface; do not add a second facade without a consumer need. The installed Effect version is a release candidate, so exposing it publicly is a real dependency choice.

Keep specification-derived tests primary. A limited comparison suite against the proposed `systemrdl-compiler==1.32.2` pin can check interoperability. No exporter is a language authority. Documentation research does not establish that an unimplemented library passes those checks.

Treat the undefined preprocessor `if`, compilation-unit boundaries, empty-array literal syntax, and contradictory reserved-enum concatenation rules as explicit interpretation decisions. Do not silently invent semantics or copy every compiler behavior.

## Next decisions

The local [Design the SystemRDL library](../wayfinder/0001-library-design.md) map tracks the remaining decisions. Research issues are closed with evidence links. The language boundary and source/editing model are accepted. Public-interface selection is ready for review.

The map is a planning aid. Human decisions close only on the user's answers. Parser implementation, exact persistent identity strategy, and measured performance needs remain later design work.
