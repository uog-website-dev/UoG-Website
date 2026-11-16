# P0-PERF-006 versus P0-PERF-005 production

**Budgets and methodology remain PROPOSED; product/QA approval is pending.**

| Scenario | Before p50 / p95 ms | After p50 / p95 ms | p95 reduction |
| --- | ---: | ---: | ---: |
| workspace_api | 28 / 29 (n=20) | 37 / 55 (n=20) | -85.7% |
| cold_site_switch | 862 / 956 (n=10) | 340 / 438 (n=10) | 54.2% |
| warm_site_switch | 182 / 302 (n=10) | 111 / 133 (n=10) | 56.1% |
| dashboard_usable | 196 / 956 (n=31) | 121 / 438 (n=31) | 54.2% |
| same_site_menu_navigation | 615 / 804 (n=10) | 478 / 724 (n=10) | 9.9% |
| cached_section_return | 126 / 165 (n=10) | 80 / 95 (n=10) | 42.7% |
| cached_section_transition | 141 / 218 (n=10) | 77 / 101 (n=10) | 53.4% |

| Scenario | Median Django requests before / after | Median SQL count before / after |
| --- | ---: | ---: |
| workspace_api | 1 / 1 | 10 / 10 |
| cold_site_switch | 20 / 4 | 381 / 50 |
| warm_site_switch | 0 / 0 | 0 / 0 |
| same_site_menu_navigation | 3 / 3 | 197 / 197 |
| cached_section_return | 0 / 0 | 0 / 0 |
| cached_section_transition | 0 / 0 | 0 / 0 |

The direct workspace API probe uses the same authenticated Next URL in both runs. Both runs use the searchable Workspace dialog and include discovery in Site-switch timing. The Site count is unchanged. Sequential local runs, retained database/server caches and small samples do not establish causal attribution for every timing difference.

Raw samples preserve browser request counts, endpoint duplication, transferred bytes and waterfalls; correlated traces preserve SQL aggregates. Dedicated browser/component regressions verify cache reuse, scope isolation and shared context requests.

