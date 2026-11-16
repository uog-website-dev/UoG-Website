# P0-PERF-008 read transport comparison

**Budgets/methodology remain PROPOSED pending product/QA approval.**

| Scenario | Before p50 / p95 ms | After p50 / p95 ms | p50 total requests before / after | p50 read action POSTs before / after | p50 JSON read GETs before / after | p50 transferred bytes before / after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| cold_site_switch | 324 / 340 | 393 / 447 | 16 / 16 | 2 / 0 | 0 / 2 | 14300 / 14390 |
| warm_site_switch | 102 / 141 | 108 / 139 | 1 / 1 | 0 / 0 | 0 / 0 | 1479 / 1479 |
| same_site_menu_navigation | 277 / 483 | 215 / 457 | 10 / 11 | 3 / 0 | 0 / 2 | 26609 / 25184 |
| cached_section_return | 81 / 110 | 98 / 106 | 2 / 2 | 0 / 0 | 0 / 0 | 2995 / 3019 |
| cached_section_transition | 81 / 91 | 96 / 98 | 1 / 1 | 0 / 0 | 0 / 0 | 1479 / 1479 |

The scenario named same_site_menu_navigation opens the Pages section through the workspace navigation; it does not mean the Menus editor. Counts include route code/favicon traffic inside the same measurement boundary. Physical browser→Next→Django trust boundaries remain. GETs remove the read-action Flight framing and action queue; they do not bypass Next authentication. Cached returns retain the shared query cache. Raw samples preserve bytes, requests, waterfalls and SQL counts.

Latency and transferred bytes are end-to-end protocol/transport observations, not pure CPU serialization timings. Browser-reads evidence separately measures response JSON parsing and the instrumented BFF/upstream/JSON-encoding spans. Before/after runs are sequential local smoke samples; retained caches and host activity can affect results. A Menu directory now uses two parallel GETs for menus/inheritance rather than one action with two sequential upstream reads: that trades one additional browser request for parallel progress. Specialized editor actions remain documented in the inventory.
