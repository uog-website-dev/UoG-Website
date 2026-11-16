# P0-PERF-003 versus P0-PERF-002 production

**Budgets and methodology remain PROPOSED; product/QA approval is pending.**

| Scenario | Before p50 / p95 ms | After p50 / p95 ms | p95 reduction |
| --- | ---: | ---: | ---: |
| workspace_api | 31 / 50 (n=20) | 27 / 29 (n=20) | 42.5% |
| cold_site_switch | 915 / 1520 (n=10) | 851 / 1043 (n=10) | 31.4% |
| warm_site_switch | 949 / 1014 (n=10) | 891 / 1114 (n=10) | -9.8% |
| dashboard_usable | 910 / 1198 (n=31) | 848 / 1043 (n=31) | 13.0% |
| same_site_menu_navigation | 768 / 815 (n=10) | 463 / 702 (n=10) | 13.9% |
| cached_section_return | 768 / 1138 (n=10) | 112 / 182 (n=10) | 84.0% |
| cached_section_transition | 583 / 777 (n=10) | 137 / 195 (n=10) | 74.9% |

| Scenario | Median Django requests before / after | Median SQL count before / after |
| --- | ---: | ---: |
| workspace_api | 1 / 1 | 10 / 10 |
| cold_site_switch | 19 / 20 | 348 / 370 |
| warm_site_switch | 19 / 20 | 348 / 370 |
| same_site_menu_navigation | 5 / 3 | 210 / 197 |
| cached_section_return | 17 / 0 | 328 / 0 |
| cached_section_transition | 5 / 0 | 210 / 0 |

The direct workspace API probe uses the same authenticated Next URL in both runs. Both runs use the searchable Workspace dialog and include discovery in Site-switch timing. Same host/dataset/profile, sequential local runs, retained database/server caches and small samples do not establish causal attribution for every timing difference.

Raw samples preserve browser request counts, endpoint duplication, transferred bytes and waterfalls; correlated traces preserve SQL aggregates. Dedicated browser/component regressions verify cache reuse, scope isolation and shared context requests.

