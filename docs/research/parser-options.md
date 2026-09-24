# Parser options for source-preserving editing

Research date: 2026-09-23. Context7 resolved Chevrotain and ANTLR4ng; official documentation and tagged source supplied the evidence below. No parser, dependencies, or executable prototype were added.

## Recommendation

Use **Chevrotain 13.2.0 as a private parser dependency**, with an independent source-document and preprocessing layer. Keep its tokens, CST nodes, mutable parser instances, and recovery mechanics out of the public interface. The library's own syntax records and diagnostics are the stable boundary.

This version is the current npm `latest`, published 2026-08-01, according to the [registry metadata](https://registry.npmjs.org/chevrotain). It is ESM, Apache-2.0 licensed, and declares Node.js >=22. The [official README](https://github.com/Chevrotain/chevrotain/blob/master/README.md) documents browser ESM bundles and current evergreen-browser support. Browser execution does not require Node.js. This selection assumes modern browsers; bundling and actual target-browser execution remain implementation checks.

The reason is practical: TypeScript grammar code, configurable recovery, and built-in CST construction reduce parser infrastructure we would otherwise maintain. Preprocessing and source preservation still need our own design. The recommendation is a reversible internal choice and does not require another scope interview.

## Comparison

| Approach | Useful capabilities | Work and limitations for this library |
| --- | --- | --- |
| Handwritten scanner, recursive descent, and Pratt expressions | Full control over source spans, missing syntax, synchronization, and context-specific diagnostics. No parser runtime dependency. | We must implement and maintain grammar lookahead, precedence, error recovery, progress guarantees, and ambiguity handling. Good fallback if library recovery prevents reliable source targeting. There is no existing implementation here proving lower cost or speed. |
| Chevrotain lexer and `CstParser` | TypeScript-compatible grammar definitions without code generation. Token grouping, configurable recovery, and partial CST output. | Port the grammar and factor LL lookahead ambiguities. Preserve trivia independently and normalize recovery. Initialization and tree allocation need measurement. No measured SystemRDL performance claim. |
| Official ANTLR TypeScript target | Generate from a `.g4` grammar, retain hidden-channel tokens, use parse-tree visitors and established error strategies. Browser runtime is available. | Maintain generator/runtime alignment, generated sources, and source-model adapters. The upstream SystemRDL lexer discards trivia unless changed. Generated parse trees still do not solve macro origin or edit correctness. |
| ANTLR4ng | Separate TypeScript runtime with browser support and hidden-token access. | Adds another generator/runtime combination to select and maintain. No requirement here justifies choosing it over the official ANTLR target if we switch to ANTLR. |

Chevrotain's [token groups](https://chevrotain.io/docs/features/token_grouping.html) retain comments outside the parser's normal token list. Whitespace can use the same mechanism. Its [CST documentation](https://chevrotain.io/docs/guide/concrete_syntax_tree.html) supports offset tracking and partial nodes, but recovered nodes can lack expected children. These capabilities help preserve provenance; they do not constitute a lossless document model.

Chevrotain's [recovery documentation](https://chevrotain.io/docs/tutorial/step4_fault_tolerance.html) describes token insertion, deletion, and resynchronization. Recovery can omit input from the returned tree. Enable recovery explicitly and convert all such events into diagnostics and uncertainty on the affected syntax. A parser's synthetic semicolon must never appear in saved text unless an explicit edit adds it.

Its [initialization guide](https://chevrotain.io/docs/guide/initialization_performance.html) explains runtime grammar analysis and the cost of increased lookahead. Reuse parser infrastructure within an analysis worker, reset parse state between inputs, and avoid solving every grammar ambiguity by increasing global lookahead. Do not share one mutable parser between concurrent operations.

The [official ANTLR TypeScript target](https://github.com/antlr/antlr4/blob/4.13.2/doc/typescript-target.md) uses the JavaScript runtime with TypeScript declarations and generates TypeScript lexer/parser classes. Its [4.13.2 recovery implementation](https://github.com/antlr/antlr4/blob/4.13.2/runtime/JavaScript/src/antlr4/error/DefaultErrorStrategy.js) includes insertion, deletion, and resynchronization. [CommonTokenStream](https://github.com/antlr/antlr4/blob/4.13.2/runtime/JavaScript/src/antlr4/CommonTokenStream.js) filters parser lookahead by channel while retaining buffered tokens. Hidden tokens differ from skipped tokens: skipping loses them from that stream.

The current registry releases checked were [antlr4 4.13.2](https://registry.npmjs.org/antlr4) and [antlr4ng 3.0.16](https://registry.npmjs.org/antlr4ng). The [ANTLR4ng repository](https://github.com/mike-lischke/antlr4ng) documents its modern JavaScript/browser runtime and compatible generator. Neither alternative was executed here.

An incremental tree-sitter integration is not needed to decide the initial parser. The agreed scope has no incremental-parsing latency guarantee. Revisit incremental parsing only if representative measurements show full reparsing is inadequate.

## Grammar reuse

The [SystemRDL compiler's tagged grammar](https://github.com/SystemRDL/systemrdl-compiler/blob/v1.32.2/src/systemrdl/parser/SystemRDL.g4) provides a useful production checklist and an ANTLR starting point. It includes constraints syntactically even though compiler semantics defer them. Its comment and whitespace rules use `skip`; they must change for token-based trivia retention.

The upstream [MIT license](https://github.com/SystemRDL/systemrdl-compiler/blob/v1.32.2/LICENSE) permits adaptation with preservation of the required copyright and permission notice. If we copy or substantially translate productions, record the upstream version and include that notice with the adapted source. Do not assume translating grammar notation removes attribution requirements. The local specification remains intentionally untracked; do not copy it into the repository.

Whether implemented through Chevrotain or ANTLR, grammar rules must follow our accepted language-boundary decisions. An upstream grammar is evidence, not proof of conformance. Parsing a deferred construct can still help bound its source region without claiming semantic support.

## Concrete architecture

1. **Source documents retain the supplied strings.** Index physical UTF-16 offsets and line boundaries without normalizing whitespace, newlines, comments, or invalid text. No-edit serialization returns those strings directly. Saving never prints a parser tree.
2. **Raw scanning partitions each document.** Retain ordinary tokens, trivia, directives, inactive text, invalid fragments, and unsupported Perl regions. Every input character belongs to a retained span. Chevrotain lexer modes or custom patterns can assist; document retention must not depend on successful lexing.
3. **Preprocessing creates a separate expansion.** Interpret the supported directives over caller-provided files and configuration. Preserve definitions, invocations, include boundaries, and inactive branches in the source layer. Lex the expanded text for the language parser.
4. **Expansion segments carry origin chains.** Map expanded ranges to physical source ranges, include sites, macro definitions, arguments, and invocation sites. Concatenation or substitution can make one token derive from multiple spans. Do not force every token to have one editable source range.
5. **Chevrotain parses expanded syntax.** Build a private CST, then typed syntax records with source origins and recovery markers. Cover the complete accepted grammar, including expressions through explicit precedence rules. Keep type checking, UDP validation, name binding, and elaboration outside the parser.
6. **Analysis derives semantics separately.** Resolve declarations and instances against a specific configuration. Properties retain their effective value and assignment/default origin. Physical source regions remain available even when semantic analysis is incomplete.
7. **Editing prepares source patches.** Resolve intent to an unambiguous physical target, reject unsupported macro transformations, and patch only necessary spans. Reparse the candidate and validate the final grouped result. Never use CST traversal order as a substitute for original character order.

The raw-source and expanded-syntax layers solve different problems. An inactive branch can contain an incomplete declaration fragment, and a macro can supply half a declaration. We should not require every raw file or branch to independently parse as SystemRDL. Configuration-specific syntax and partial raw-source inspection can coexist without inventing a universally valid raw AST.

Keep physical locations separate from `line`-directive diagnostic locations. A logical filename or line number is unsuitable as an edit address. Preserve supplementary Unicode characters in source and verify offset conversions rather than assuming every parser runtime uses identical indexing.

## Malformed and unsupported input

An insertion/deletion recovery marks the enclosing affected syntax uncertain even when a parser still returns a complete-looking node. Record skipped spans as well. Downstream structured operations must establish reliable target boundaries and their stated effects; a recovered tree alone cannot authorize them.

Recover at declaration and statement boundaries where those boundaries are reliable. Missing quotes or comments can obscure a later brace, so do not blindly synchronize on every semicolon or closing brace. Retain an opaque remainder if no reliable boundary exists. Parsing must always make progress or terminate with a diagnostic.

Detect Perl boundaries according to the accepted source policy and retain their exact text. Unclosed regions become opaque through end of document. Do not erase Perl and treat its surrounding text as a fully validated expansion. Limited inspection of independently identified source regions is permissible; complete semantics remain unavailable when Perl can affect them.

Expected malformed-input failures become diagnostics or typed failure values. Translate parser-library internals at the boundary. Keep grammar-definition defects distinct from normal user-source errors so programming bugs are not silently reported as invalid SystemRDL.

## Milestone gates instead of a separate prototype

A throwaway prototype is not necessary before choosing this private dependency. The first implementation milestone should validate the risks before expanding the entire grammar:

- Parse representative UDP, struct, parameter, alias, array, and expression forms. Verify ambiguous prefixes and precedence against specification-derived fixtures.
- Preserve every character through unchanged serialization, including mixed newlines, comments, invalid tokens, and supplementary Unicode.
- Recover from a missing semicolon and malformed declaration without manufacturing editable targets or losing unrelated source.
- Trace nested includes and function-like macro substitutions to physical origins. Refuse edits of tokens with generated or ambiguous provenance.
- Preserve inactive fragments and unsupported Perl, including missing delimiters. Confirm that no complete-analysis result escapes those limitations.
- Bundle and run the actual browser entry point without filesystem or Node polyfills. Measure initialization, parse time, and memory using representative synthetic projects before promising responsiveness.

If grammar factoring or recovery normalization becomes more work than an ANTLR adapter, switch the private parser while keeping source documents, origin records, semantic analysis, and the public API. If recovery precision remains inadequate in either framework, use handwritten parsing for the affected grammar region before replacing the whole parser.

No test results, bundle measurements, or SystemRDL conformance claims follow from this documentation research. The gates above remain implementation work.
