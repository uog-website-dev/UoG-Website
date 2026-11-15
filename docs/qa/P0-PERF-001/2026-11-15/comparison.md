# P0-PERF-001 local baseline comparison

**All budgets and measurement conditions remain PROPOSED; product/QA acceptance is pending.**

| Scenario | Production p50 / p95 (ms) | Development p50 / p95 (ms) | Proposed p95 budget (ms) |
| --- | ---: | ---: | ---: |
| first_site_visit | 2010 / 2010 (n=1) | 13117 / 13117 (n=1) | ? |
| dashboard_usable | 1412 / 2342 (n=31) | 2121 / 4816 (n=31) | 1500 |
| paginated_list_api | 297 / 440 (n=60) | 270 / 443 (n=60) | 400 |
| workspace_api | 548 / 709 (n=20) | 469 / 703 (n=20) | 500 |
| cold_site_switch | 1696 / 2455 (n=10) | 2176 / 4816 (n=10) | 2000 |
| warm_site_switch | 1127 / 2342 (n=10) | 2183 / 2444 (n=10) | 1000 |
| same_site_menu_navigation | 763 / 1935 (n=10) | 1779 / 6966 (n=10) | ? |
| cached_section_return | 1102 / 2118 (n=10) | 1599 / 4727 (n=10) | 300 |
| cached_section_transition | 685 / 1142 (n=10) | 1345 / 2121 (n=10) | 500 |

## Production request and SQL fan-out

| Scenario | Median browser requests | Median Django requests | Median SQL statements | Median aggregate SQL ms | Median transfer bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| cold_site_switch | 21 | 25 | 891 | 756 | 22808 |
| warm_site_switch | 10 | 21 | 605 | 579 | 14446 |
| same_site_menu_navigation | 9 | 5 | 210 | 195 | 22590 |
| cached_section_return | 10 | 17 | 328 | 291 | 14388 |
| cached_section_transition | 5 | 5 | 210 | 174 | 8434 |

SQL duration sums statements across requests; it is not a wall-clock critical-path duration and must not be subtracted from the navigation time.

## API latency by resource and first/repeat condition

| API / condition | Production p50 / p95 ms | Development p50 / p95 ms |
| --- | ---: | ---: |
| workspace / cold | 513 / 709 (n=10) | 469 / 1436 (n=10) |
| workspace / warm | 552 / 2297 (n=10) | 424 / 703 (n=10) |
| pages / cold | 278 / 479 (n=10) | 276 / 443 (n=10) |
| pages / warm | 297 / 383 (n=10) | 296 / 495 (n=10) |
| posts / cold | 347 / 565 (n=10) | 306 / 541 (n=10) |
| posts / warm | 335 / 440 (n=10) | 316 / 442 (n=10) |
| assets / cold | 64 / 81 (n=10) | 81 / 150 (n=10) |
| assets / warm | 55 / 136 (n=10) | 65 / 105 (n=10) |

Production is the release-mode baseline. Development includes compilation, refresh and unoptimized runtime behavior. The first-site diagnostic has one sample per fresh service process; it is not a population p95. At ten navigation samples the nearest-rank p95 is the slowest sample; use larger repeated runs for acceptance.

Production: 131 samples, 903 Django spans, 843 Next upstream spans.
Development: 131 samples, 941 Django spans, 881 Next upstream spans.

