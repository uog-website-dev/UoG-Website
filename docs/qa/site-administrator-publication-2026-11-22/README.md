# Site Administrator direct publication

Site Administrators with a live canonical membership may publish their own Site Pages (including visual homepages) and Posts directly from Draft, In Review or Unpublished. Platform Administrators retain the same capability. Other editorial roles continue to require the existing review handoff. Menus already support direct publication through their existing authorized service.

Open Pages or Posts and choose Publish; for visual Pages, save changes first so the current ETag is submitted. Published content offers Unpublish; unpublished content now offers Publish again. Homepage assignment still requires an eligible published Page and is a separate Site setting.

Direct publication runs the existing restore (when needed), submission, administrative approval and publish transitions in one transaction. Intermediate approval history explicitly identifies administrative publication. A failed validation rolls back every intermediate revision and transition. Immutable publication snapshots, storage/media validation, stale revision checks, module gates and tenant boundaries remain enforced. Ordinary author self-review and self-rejection remain denied; administrators can approve their own content under this policy.

The shared UI derives controls from the backend available_actions response. No browser role flags or token claims authorize this exception. Expired/revoked memberships and inactive users/roles do not qualify. No schema migration is required.

## Verification

- Backend suite: 72 passed, zero failures/errors/skips; workflow, canonical membership authorization, Page API, Menu API and visual publication regressions. See backend-tests.xml.
- Frontend: content-workflow.test.tsx, 3 passed, including backend-authorized direct Publish control.
- OpenAPI generated and validated with spectacular --validate --fail-on-warn; docs/api/openapi.yaml updated.
- Django system check: no issues.

Backend command:

```sh
pytest apps/cms/tests/test_workflow.py apps/cms/tests/test_membership_authorization.py apps/cms/tests/test_page_api.py apps/cms/tests/test_menu_api.py tests/test_visual_publication.py -q --create-db --junitxml=/tmp/admin-direct-publication.xml
```

No existing editorial content was published or unpublished during verification. External QA sign-off and real-browser role verification are not claimed by this test evidence.
