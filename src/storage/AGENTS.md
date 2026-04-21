# Storage Guidance

- Keep [database.ts](./database.ts) as the stable facade while extracting schema, migration, and domain-specific persistence helpers underneath it.
- Prefer domain splits such as threads, planner state, provider cache, collaboration cache, and storage maintenance over generic utility buckets.
- Maintain migration compatibility and crash-tolerant writes; do not trade correctness for line-count reduction.
- Before adding new persistence features to oversized storage files, run `npm run audit:maintainability` and update the next extraction slice in [docs/engineering/WORKLOG.md](../../docs/engineering/WORKLOG.md).
