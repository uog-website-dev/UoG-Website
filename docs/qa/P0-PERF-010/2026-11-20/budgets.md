# Final production budget results

Status: **FAIL** against proposed ceilings. No release authorization.

| Scenario | n | p50 ms | p95 ms | Proposed p95 ms | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| warm_site_switch | 30 | 124.6 | 149.7 | 1000 | PASS |
| cold_site_switch | 30 | 330.8 | 390.1 | 2000 | PASS |
| cached_section_return | 30 | 87.7 | 104.1 | 300 | PASS |
| cached_section_transition | 30 | 84.5 | 104.3 | 500 | PASS |
| workspace_api | 60 | 25.9 | 32.4 | 500 | PASS |
| paginated_list_api | 180 | 35.5 | 58.8 | 400 | PASS |
| dashboard_summary_api | 60 | 23.3 | 36.4 | 500 | PASS |
| cached_pages_return | 30 | 301.6 | 323.8 | 300 | FAIL |
| cached_posts_return | 30 | 304.0 | 317.4 | 300 | FAIL |
| cached_menus_return | 30 | 183.3 | 326.3 | 300 | FAIL |
| cached_media_return | 30 | 229.9 | 281.8 | 300 | PASS |
| dashboard_usable | 91 | 126.3 | 372.3 | 1500 | PASS |
| same_site_menu_navigation | 30 | 229.0 | 423.0 | 1000 | PASS |
