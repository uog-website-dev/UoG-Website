# PR 77 backend CI repair ? 15 November 2026

The Azure test annotation identifies `test_schema_validates_without_warnings_and_describes_live_contract` as failing: its exact route inventory omitted eight implemented routes. The GitHub backend job failed in the same backend/OpenAPI stage. [Original GitHub job](https://github.com/uog-website-dev/UoG-Website/actions/runs/43682671442/job/132716463668?pr=77), [Azure check](https://github.com/uog-website-dev/UoG-Website/pull/77/checks?check_run_id=132719086750), [retrieved annotations](ci-annotations.json).

The fix adds homepage catalogue/preparation, menu location list/draft/publication, menu target inventory and private menu preview routes to the expected set. It keeps exact route equality and adds explicit bearer-authentication/HTTP-method checks for these eight routes. It also asserts the template-preparation request requires only `template_id` and `version`, preventing unexpected privileged input fields from silently entering the documented contract.

Validation:

- The original contract failure was reproduced. The corrected targeted contract test passes: [JUnit](contract-test.xml).
- OpenAPI generates and validates with `--validate --fail-on-warn`; parsed equality with the committed `docs/api/openapi.yaml` passes across 121 paths. The baseline did not need changing.
- Full backend result: **1126 passed, 4 skipped, zero failures/errors**. [JUnit](backend-tests.xml), [output](backend-tests.txt). Ran `pytest -q --reuse-db --create-db --tb=short --junitxml=/tmp/homepage-ci-full.xml` against local PostgreSQL; exit code 0.

Skipped checks:
- `test_documented_block_contract_matches_the_domain`: The runtime image ships code only; docs live in the checkout.
- `test_real_minio_duplicate_and_missing_thumbnail_fallback`: Requires private MinIO integration environment
- `test_real_minio_accepted_cleanup_removes_only_owned_objects`: Requires private MinIO integration environment
- `test_real_private_minio_interrupted_put_retry_worker_and_cleanup`: Requires local private MinIO integration environment

The change is confined to contract-test maintenance; no production endpoint, authorization behavior, migration or frontend code changed. Remote CI has not been rerun by this local verification. A new PR run is required after pushing the fix.
