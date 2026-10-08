# What changed in the code after Batches Câ€“F were designed

Batches Câ€“F were designed on 2026-10-02, before Batch B was built. Batch B changed
some things those designs assume. **Read this file with each design's "Verify before
starting" table**, and add a dated line here whenever a merged batch changes a rule,
a name, a status value or a table that a later design relies on. This file is the
running answer to "does the design still match the code?"; the design drift check
(`docs/designs/README.md`) starts here.

Last updated: 2026-10-05. **The D, E and F designs were rewritten on 2026-10-05 against `main` 47bd833 with everything below already folded in**, and B2/E2 were written fresh against the same code. From now on, add a dated entry here when a batch merges (B2's section 8 lists what to add for it).

## Current checkpoint â€” 2026-10-08, main b2a06c2 (#310)

A/B/C/R/B2/D/E/E2, F-part-1 and G are built; T is built through filing
finalization/amendments T-6b2. Use STATUS and MASTER-ROADMAP for current sequence,
not this file's older prospective wording. The documentation reset PR #311
adds no runtime behavior. It adds per-card/base drift checks, JIT authoring and
explicit T/S contract amendments; those future schemas are not yet shipped.
Near-term acquisition/RDF/tax-screen cards and S cards still require their real
predecessors. Later work has compact coverage, not re-verified execution cards.
The S/F/K/O acceptance refinements are in the existing designs; keep signed
¶»§q«^