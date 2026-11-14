# CI failure corrections — 14 November 2026

This change addresses the backend and frontend failures reported for commit `73626a6623f264797c55624b537edef74e9cc378`.

| Reported failure | Cause and correction |
| --- | --- |
| Media picker could not find “Edit Admissions” button | Page administration now navigates through an Edit link to a dedicated editor. The test checks that route and renders the real editor before verifying that a failed save preserves the selected image, alt text and block JSON. |
| Demo seed expected only three modules | The approved demo also enables VISUAL_BUILDER. The test now expects the exact four-module set. Production seeding behavior is unchanged. |
| Historical compact-UUID migration referenced missing approved_revision_id | The fixture invoked today's Page save/revision-retention code against an older schema. It now creates the historical Page and revision using baseline models inside the guarded revision-write transaction, then checks indexing and immutable history after upgrade. |
| Organization boundary check found three imports | The second DEBUG-only composition command receives the same narrow model/lock import exception as the existing demo command. Runtime Post working drafts now use a shared CMS draft-write facade instead of importing the organization lock directly. The actual transaction/serialization behavior is unchanged. |
| Deletion during derivative PUT failed its status transition | Media migration 0013 installed the article-reference guard from an older function definition, losing migration 0010's guarded deletion exception. New migration `media.0014_restore_guarded_processing_deletion` restores that exception while retaining article references and every other asset guard. Applied migrations were not rewritten. |

The media regressions also verify that ordinary writes cannot archive PENDING or REJECTED assets; accepted deletion must set the tombstone through the removal service. The REJECTED fixture uses the real worker failure path, respecting the existing rule that metadata writes cannot complete upload processing.

## Validation evidence

- [Full backend results](backend-tests.xml) and [backend log](backend-final.log).
- [All frontend workspace tests](frontend-all.log): API client, shared UI and admin-web.
- [TypeScript](typecheck.log).
- [Targeted reported backend failures](backend-targeted.xml), [media lifecycle regressions](media-fixes-tests.xml), and [media picker regression](media-picker-tests.xml).
- [Installed guard verification](installed-guard.json), [validation summary](validation.json) and [source hashes](source-manifest.json).

The first full backend attempt caught an invalid setup in the new REJECTED-asset regression: it attempted an ordinary state write that the worker guard correctly rejected. That setup was changed to use a real worker rejection, and all six media-fix cases then passed before the final clean-database run. Raw intermediate logs are diagnostic records, not passing release evidence.

Commands use the existing Docker services and pinned dependencies:

```sh
docker compose exec -T backend pytest -q --create-db --reuse-db --tb=short --maxfail=1 --junitxml=/tmp/ci-backend-final.xml
docker compose exec -T frontend-admin pnpm test
docker compose exec -T frontend-admin pnpm typecheck
```

The corrected guard migration is applied locally. Deployment must apply `media.0014_restore_guarded_processing_deletion` with the existing migration-role process. There is no frontend production behavior change in this patch; the frontend change corrects test coverage for the already implemented full-page editor. No dependency update is required.

Remote Azure/GitHub checks have not been rerun by this local verification; push the changes and rerun the pipeline. Independent review and PR association remain pending.

Final local results: **1051 backend tests passed, 5 skipped, zero failures/errors** on a clean test database. **887 frontend tests passed** (165 API client, 192 shared UI, 530 admin-web). Workspace TypeScript, Django check, migration drift check and whitespace verification passed. Skip reasons are recorded in validation.json.
