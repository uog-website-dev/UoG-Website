# Production navigation comparison

This comparison describes the recorded environments, not an isolated causal speedup. The prior run has fewer samples and predates merged homepage, branding, SEO and editorial changes. Budgets and reviewer approval remain separate release requirements.

| Scenario | Prior p50 / p95 ms | Final p50 / p95 ms |
| --- | ---: | ---: |
| cold_site_switch | 336 / 470 (n=10) | 331 / 390 (n=30) |
| warm_site_switch | 105 / 136 (n=10) | 125 / 150 (n=30) |
| same_site_menu_navigation | 217 / 456 (n=10) | 229 / 423 (n=30) |
| cached_section_return | 87 / 122 (n=10) | 88 / 104 (n=30) |
| cached_section_transition | 85 / 111 (n=10) | 84 / 104 (n=30) |
| cached_pages_return | Not measured | 302 / 324 (n=30) |
| cached_posts_return | Not measured | 304 / 317 (n=30) |
| cached_menus_return | Not measured | 183 / 326 (n=30) |
| cached_media_return | Not measured | 230 / 282 (n=30) |
| workspace_api | 29 / 46 (n=20) | 26 / 32 (n=60) |
| paginated_list_api | 36 / 45 (n=60) | 36 / 59 (n=180) |
| dashboard_summary_api | 22 / 33 (n=20) | 23 / 36 (n=60) |
| dashboard_usable | 110 / 470 (n=31) | 126 / 372 (n=91) |

Percentiles use nearest rank over raw samples. First process visit is excluded from percentile acceptance. Raw waterfall and correlated SQL evidence accompany each run.

