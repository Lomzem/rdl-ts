# Preserve unsupported source and restrict dependent operations

The library preserves documents containing unsupported constructs and reports whether analysis is complete, partial, or unavailable, with reasons. Structured edits require a reliably identified target and enough information to fulfill the operation's stated promise. An exact source replacement does not promise complete knowledge of semantic effects; a complete reference-aware rename requires reference coverage. This permits source retention without presenting incomplete interpretations as complete results or rejecting every document containing an unsupported feature.

Perl execution is excluded. Embedded Perl remains in the source, but the library refuses structured edits that depend on interpreting it. Includes, macros, and conditional compilation are in scope with caller-supplied files and configuration. Automatic structured editing of macro-generated declarations is deferred.
