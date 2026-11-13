# Homepage Settings — Site Administration portal — 2026-11-12

Site Administrators assign an eligible published Page as the Site root from
Homepage Settings inside Site Administration. Dashboard, Pages, Public Preview
and the shared Page editor stay connected. Stale eligibility rejects without
changing the confirmed selection; lost eligibility shows a retained-pointer
fallback. Site switches keep Informatics and Medicine assignments independent.

## Contracts and implementation

- Policy: [site-homepage.md](../../architecture/site-homepage.md)
- Section matrix: [site-admin.ts](../../../frontend/apps/admin-web/src/sites/site-admin.ts)
- Panel: [site-homepage.tsx](../../../frontend/apps/admin-web/src/sites/site-homepage.tsx)
- Route: `/sites/{id}/admin/homepage`
- Prior API evidence: [homepage-2026-11-12](../homepage-2026-11-12/report.md)
- Coverage: [admin.xml](admin.xml)

## Evidence attachments

| Artifact | Role |
| --- | --- |
| [navigation-assignment.json](navigation-assignment.json) | Nav links, Informatics/Medicine recording, stale eligibility |
| [admin.xml](admin.xml) | Vitest JUnit (homepage panel, site-admin matrix, Pages) |

## Acceptance mapping

| Criterion | Status | Evidence |
| --- | --- | --- |
| Only eligible same-Site Pages appear | **PASS** | Draft and foreign Site Pages excluded from Eligible Page select |
| Successful assignment reflected after reload; Site switch refreshes selection | **PASS** | Success message + reload; Medicine remount shows Medicine Home only |
| Stale eligibility / permission errors leave selection intact | **PASS** | 400 keeps confirmed selection and shows unchanged message |
| Publish via Pages then assign from Homepage Settings | **PASS** | Pages ↔ Homepage Settings links; Set homepage + Assign homepage |

## Results

| Verification | Result |
| --- | --- |
| Homepage Settings + site-admin + Pages | 39 passed ([admin.xml](admin.xml)) |

Browser E2E remains waived consistent with prior homepage API pack; component
coverage exercises settings/editor routes and stale eligibility against the
shared Site homepage contract.
