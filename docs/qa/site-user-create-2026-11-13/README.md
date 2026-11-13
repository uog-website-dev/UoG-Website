# Site Admin create user — 2026-11-13

Evidence pack for Site Administration → Users create flow (username, email, password, optional profile picture, Site role).

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC-01 Create user with username, email, password, optional picture + Site role | Met | `SiteUserCreate` + `POST .../site-create-user/` |
| AC-02 Directory shows user with role; credentials work via Keycloak login rules | Met | `test_site_user_creation.py`; provisioning saga |
| AC-03 Picture stored/shown; omit without broken image | Met | `AccountProfile.picture`; Avatar fallback |
| AC-04 Role required (field-level) | Met | UI + API serializer; component test |
| AC-05 Duplicate username/email rejected; no partial assignment | Met | Local + Keycloak checks; saga rollback |
| AC-06 Site A admin cannot assign onto Site B | Met | Foreign Site 403 tests |
| AC-07 Add existing user unchanged | Met | Separate dialog + `POST /assignments/` |
| AC-08 Unauthorized / anonymous denied | Met | `platform.users.assign_roles` gate |
| AC-09 Audited create + assign | Met | `SITE_USER_CREATED` + `ROLE_ASSIGNED` |
| AC-10 Desktop/mobile a11y (labels, errors, focus) | Met | Form labels/helpers + focus-on-error test |

## Artifacts

- [backend-tests.txt](backend-tests.txt) — 24 API/provisioning cases
- [component-tests.txt](component-tests.txt) — create form + existing-user regression
- Guidance: [site-user-onboarding.md](../../site-user-onboarding.md)
- Contract: [openapi.yaml](../../api/openapi.yaml) (`site-create-user`)

Independent PR / Azure DevOps Issue attachment remain pending where not already linked.
