# P0-PERF-007 concurrent HTTP comparison

Budgets and methodology remain **PROPOSED**, pending product/QA approval. Four concurrent clients, 60 reads per endpoint, 21 Sites and two synchronous Gunicorn workers. Nearest-rank percentiles; durations include queueing, transport and response parsing.

| Endpoint | Before p50 / p95 ms | After p50 / p95 ms | Median SQL before / after | Proposed p95 budget | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| bootstrap | 87.8 / 166.9 | 31.5 / 39.0 | 10 / 10 | 500 ms | PASS |
| switcher | 70.3 / 111.8 | 32.7 / 43.5 | 10 / 10 | 500 ms | PASS |
| pages | 1056.8 / 1325.0 | 63.2 / 84.1 | 153 / 18 | 400 ms | PASS |
| posts | 1311.9 / 1667.9 | 109.1 / 180.4 | 190 / 18 | 400 ms | PASS |
| menus | 319.4 / 410.5 | 56.5 / 63.9 | 24 / 18 | 400 ms | PASS |
| media | 107.3 / 347.9 | 87.0 / 123.7 | 22 / 16 | 400 ms | PASS |
| dashboard | 45.9 / 81.3 | 52.9 / 79.1 | 11 / 11 | 500 ms | PASS |

These sequential local runs do not establish production capacity. Retained database buffers, login/JWKS warming and background host activity can affect timing. Raw samples include SQL duration and body byte counts. Dashboard samples mix safe Redis hits and misses and retain the cache-hit field for analysis. No shared authorization caching was added. Existing full CMS list payloads are preserved for compatibility; a versioned compact representation is a possible follow-up.
