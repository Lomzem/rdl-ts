# Initial workload examples

`scripts/benchmark.ts` generates two single-file projects with a shared register type, one 32-bit field per register, and implicit register addresses. It times input capture and analysis separately. Run it with `bun scripts/benchmark.ts`.

An initial run under Bun 1.4.2 in the development container produced these observations:

| Registers | Source characters | Open    | Analyze  |
| --------- | ----------------- | ------- | -------- |
| 20        | 257               | 6.2 ms  | 13.7 ms  |
| 1,000     | 10,957            | 35.5 ms | 205.6 ms |

These are single-run measurements, not latency guarantees. They exclude module startup and do not represent the owner's workplace register files. Shared definitions, macro expansion, property complexity, and machine speed affect the result. Browser analysis runs synchronously within each phase; an application can use a worker to avoid blocking its GUI.

The array tests also cover a million-element array represented by dimensions and stride. The model does not allocate a million instance objects. Indexed lookup creates a view of the requested element and its descendants.
