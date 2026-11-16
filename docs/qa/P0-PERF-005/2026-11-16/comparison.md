# P0-PERF-005 versus P0-PERF-004 production

**Budgets and methodology remain PROPOSED; product/QA approval is pending.**

| Scenario | Before p50 / p95 ms | After p50 / p95 ms | p95 reduction |
| --- | ---: | ---: | ---: |
| workspace_api | 28 / 40 (n=20) | 28 / 29 (n=20) | 26.5% |
| cold_site_switch | 892 / 1112 (n=10) | 862 / 956 (n=10) | 14.0% |
| warm_site_switch | 212 / 236 (n=10) | 182 / 302 (n=10) | -28.2% |
| dashboard_usable | 213 / 1112 (n=31) | 196 / 956 (n=31) | 14.0% |
| same_site_menu_navigation | 614 / 954 (n=10) | 615 / 804 (n=10) | 15.8% |
| cached_section_return | 126 / 171 (n=10) | 126 / 165 (n=10) | 3.4% |
| cached_section_transition | 195 / 227 (n=10) | 141 / 218 (n=10) | 4.2% |

| Scenario | Median Django requests before / after | Median SQL count before / after |
| --- | ---: | ---: |
| workspace_api | 1 / 1 | 10 / 10 |
| cold_site_switch | 20 / 20 | 381 / 381 |
| warm_site_switch | 0 / 0 | 0 / 0 |
| same_site_menu_navigation | 3 / 3 | 197 / 197 |
| cached_section_return | 0 / 0 | 0 / 0 |
| cached_section_transition | 0 / 0 | 0 / 0 |

The direct workspace API probe uses the same authenticated Next URL in both runs. Both runs use the searchable Workspace dialog and include discovery in Site-switch timing. The Site count is unchanged. Sequential local runs, retained database/server caches and small samples do not establish causal attribution for every timing difference.

Raw samples preserve browser request counts, endpoint duplication, transferred bytes and waterfalls; correlated traces preserve SQL aggregates. Dedicated browser/component regressions verify cache reuse, scope isolation and shared context requests.

