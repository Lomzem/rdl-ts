# Compiler comparison notes

SystemRDL 2.0 is the language authority. Development and CI compare four small fixtures against `systemrdl-compiler==1.32.2`. These comparisons check selected elaboration records, not full conformance or exporter behavior.

## Array span and trailing stride padding

SystemRDL 2.0 section 5.1.2.5, Example 2, describes ten 32-bit registers at a stride of 16 bytes as consuming 148 bytes. The occupied span is `stride * (count - 1) + elementSize`. There is no final unused stride interval in that span.

For `tests/fixtures/arrays.rdl`, four 4-byte registers begin at address 32 with stride 16. This library therefore reports the enclosing address map size as 84 bytes. The pinned Python compiler reports 96 bytes. The register element size and element addresses agree.

The reference test asserts both sizes explicitly and compares the remaining records for equality. It does not change the library's result to match the compiler. Revisit the discrepancy if either implementation's result changes.

## Signal-driven reset values

The specification is inconsistent about reference-valued `reset`. Section 8.3.2 demonstrates a signal supplying a field's reset value, while section 9.5.1 restricts a referenced reset value to another field of the same width.

This library accepts a field or signal of the required width, following the explicit signal example and the compiler-compatible interpretation. A specification-derived fixture covers the signal case. This is a documented interpretation of the conflicting passages, not a claim that the passages agree.

## Software access inside memories

Section 11.2 requires virtual fields' software access to match the containing memory. This library inherits the memory's access when a virtual field has no explicit setting and diagnoses an explicit conflicting setting. The pinned compiler accepts a read/write virtual field inside a read-only memory and retains the field's read/write default when no setting is supplied. The specification fixtures exercise the library's stricter interpretation.
