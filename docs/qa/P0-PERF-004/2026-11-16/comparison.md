# P0-PERF-004 versus P0-PERF-003 production

**Budgets and methodology remain PROPOSED; product/QA approval is pending.**

| Scenario | Before p50 / p95 ms | After p50 / p95 ms | p95 reduction |
| --- | ---: | ---: | ---: |
| workspace_api | 27 / 29 (n=20) | 28 / 40 (n=20) | -39.4% |
| cold_site_switch | 851 / 1043 (n=10) | 892 / 1112 (n=10) | -6.6% |
| warm_site_switch | 891 / 1114 (n=10) | 212 / 236 (n=10) | 78.8% |
| dashboard_usable | 848 / 1043 (n=31) | 213 / 1112 (n=31) | -6.6% |
| same_site_menu_navigation | 463 / 702 (n=10) | 614 / 954 (n=10) | -36.0% |
| cached_section_return | 112 / 182 (n=10) | 126 / 171 (n=10) | 6.2% |
| cached_section_transition | 137 / 195 (n=10) | 195 / 227 (n=10) | -16.3% |

| Scenario | Median Django requests before / after | Median SQL count before / after |
| --- | ---: | ---: |
| workspace_api | 1 / 1 | 10 / 10 |
| cold_site_switch | 20 / 20 | 370 / 381 |
| warm_site_switch | 20 / 0 | 370 / 0 |
| same_site_menu_navigation | 3 / 3 | 197 / 197 |
| cached_section_return | 0 / 0 | 0 / 0 |
| cached_section_transition | 0 / 0 | 0 / 0 |

The direct workspace API probe uses the same authenticated Next URL in both runs. Both runs use the searchable Workspace dialog and include discovery in Site-switch timing. The representative dataset grew from 10 to 21 Sites; this is a directional comparison under increased discovery load, not an identical-dataset experiment. Sequential local runs, retained database/server caches and small samples do not establish causal attribution for every timing difference.

Raw samples preserve browser request counts, endpoint duplication, transferred bytes and waterfalls; correlated traces preserve SQL aggregates. Dedicated browser/component regressions verify cache reuse, scope isolation and shared context requests.

