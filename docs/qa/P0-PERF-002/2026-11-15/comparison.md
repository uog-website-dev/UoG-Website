# PERF-002 versus PERF-001 production

**Budgets and methodology remain PROPOSED; product/QA approval is pending.**

| Scenario | Before p50 / p95 ms | After p50 / p95 ms | p95 reduction |
| --- | ---: | ---: | ---: |
| workspace_api | 548 / 709 (n=20) | 31 / 50 (n=20) | 93.0% |
| cold_site_switch | 1696 / 2455 (n=10) | 915 / 1520 (n=10) | 38.1% |
| warm_site_switch | 1127 / 2342 (n=10) | 949 / 1014 (n=10) | 56.7% |
| dashboard_usable | 1412 / 2342 (n=31) | 910 / 1198 (n=31) | 48.8% |
| same_site_menu_navigation | 763 / 1935 (n=10) | 768 / 815 (n=10) | 57.9% |
| cached_section_return | 1102 / 2118 (n=10) | 768 / 1138 (n=10) | 46.3% |
| cached_section_transition | 685 / 1142 (n=10) | 583 / 777 (n=10) | 31.9% |

| Scenario | Median Django requests before / after | Median SQL count before / after |
| --- | ---: | ---: |
| workspace_api | 4 / 1 | 277 / 10 |
| cold_site_switch | 25 / 19 | 891 / 348 |
| warm_site_switch | 21 / 19 | 605 / 348 |
| same_site_menu_navigation | 5 / 5 | 210 / 210 |
| cached_section_return | 17 / 17 | 328 / 328 |
| cached_section_transition | 5 / 5 | 210 / 210 |

The direct workspace API probe uses the same authenticated Next URL in both runs. Site-switch interaction now includes opening and loading the lazy searchable dialog; PERF-001 used an already populated native selector. Same host/dataset/profile, sequential local runs, retained database/server caches and small samples do not establish causal attribution for every timing difference.

Raw samples preserve browser request counts, endpoint duplication, transferred bytes and waterfalls; correlated traces preserve SQL aggregates. The dedicated browser regression separately asserts one bootstrap per selection and no discovery before opening the switcher.

