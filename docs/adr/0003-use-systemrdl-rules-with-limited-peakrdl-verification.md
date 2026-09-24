# Use SystemRDL rules with limited PeakRDL verification

SystemRDL 2.0 defines the library's language rules, including standard UDP validation. Workplace use makes PeakRDL interoperability necessary, but individual exporters do not constrain the library's language model. First-release semantic coverage may defer features unsupported by the target compiler without reporting them as invalid SystemRDL.

Specification-derived tests provide the main correctness checks. A limited set of pinned PeakRDL/compiler checks in development and CI verifies interoperability. Investigate and document discrepancies instead of treating compiler output as the sole authority. Python tooling is permitted for those checks, but the shipped library requires neither Python nor a server.

Consumers may add TypeScript validation for custom UDP requirements. Reproducing arbitrary Python validators or exporter restrictions is outside the first-release requirement.
