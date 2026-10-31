# Unified authorization and RBAC

Django and PostgreSQL are authoritative for application authorization. Keycloak authenticates a user and supplies identity claims only; realm roles, Django groups, `is_staff`, `is_superuser`, and browser state never grant a management capability. Admin UI hiding improves usability but is not an enforcement boundary.

## Decision model

Each checked permission must exist in three places: the reviewed executable catalog (`apps.authorization.catalog.CAPABILITIES`), an active `Permission` row, and an active `RolePermission` attached to a live user assignment. Unknown codes fail closed. The catalog describes executable application behavior; it is deliberately not an API for creating capabilities at runtime.

Assignments are `PLATFORM`, `ORGANIZATION`, or `SITE`. Organization assignments cover that organization and its descendants. Site assignments cover one Site only. Site ownership is read from the Site row, never from a request-provided organization. Expired, revoked, inactive-user, inactive-role, and inactive-permission grants do not authorize. A platform assignment only grants the specific capabilities on its role; the explicit system Platform Administrator is the audited narrow bypass for the documented `PLATFORM_ADMIN` capability set.

Run `python manage.py seed_rbac` after migrations and on every backend startup. It is idempotent, updates the reviewed standard templates, and never grants a user an assignment. In local Compose only, `DEV_PLATFORM_ADMIN_BOOTSTRAP=True` with `DEBUG=True` grants a database assignment to exactly `DEV_PLATFORM_ADMIN_USERNAME` (default `devuser`) at that user's first authenticated API request. This uses explicit local configuration, not a Keycloak role claim. Production and shared deployments must leave the setting off and provision the first platform administrator through controlled operations.

## Registered permission catalog

| Stable code | Resource / action | Notes |
|---|---|---|
| `platform.dashboard.view` | platform dashboard / view | Platform aggregate overview. |
| `platform.sites.manage_registry` | site registry / manage | Platform-wide module and template registry. |
| `platform.organizations.view`, `.create`, `.update` | organization / view, create, update | Create requires an assigned parent; root creation is platform-only. |
| `platform.users.view`, `platform.users.assign_roles` | identity / view, assign roles | Assignment actions additionally enforce delegation and scope boundaries. |
| `platform.roles.view`, `.create`, `.update`, `.assign_permissions` | role / view, create, update, assign permissions | Runtime editing applies to custom roles only. |
| `sites.view`, `sites.create`, `sites.update` | site / view, create, update | Includes scoped domains, per-site modules and lifecycle operations. |
| `content.pages.view`, `.create`, `.update`, `.delete`, `.publish` | page / view, create, update, delete, publish | Page creates default unpublished; publishing is a separate permission. Site ownership is optional for legacy platform-wide pages. |
| `content.pages.submit_review`, `content.pages.approve` | page workflow / submit, approve | Registered but not executable: no review state machine exists yet. |
| `content.posts.*`, `content.menus.*`, `content.media.*` | post, menu, media operations | Registered for reviewed future capabilities, currently non-executable because those models/routes are absent. |
| `audit.logs.view`, `audit.logs.export` | authorization audit / view, export | Audit listing is implemented; a separate export operation is not. |

`content.pages.publish` currently toggles the existing `is_published` field. There is no page revision, submit/review/approval state machine or requirement that a page be reviewed before publishing. Those workflow actions therefore remain unavailable rather than being represented by a misleading role grant.

## Standard role template matrix

`✓` means the seed assigns the capability, subject to assignment scope and the target's own authorization rules; `—` means it does not. Role codes are stable lower-kebab identifiers.

| Capability group | Platform Administrator | Organization Administrator | Site Administrator | Editor | Reviewer | Publisher | Viewer |
|---|---:|---:|---:|---:|---:|---:|---:|
| Dashboard view | ✓ | ✓ | ✓ | — | — | — | ✓ |
| Organization view | ✓ | ✓ | — | — | — | — | ✓ |
| Organization create/update | ✓ | update | — | — | — | — | — |
| User view / assign roles | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | — | — | — | view |
| Role view/create/update/assign permissions | ✓ / ✓ / ✓ / ✓ | view | — | — | — | — | view |
| Site view/create/update | ✓ / ✓ / ✓ | ✓ / ✓ / ✓ | ✓ / — / ✓ | — | — | — | view |
| Page view/create/update | ✓ | ✓ | ✓ | ✓ | view | view | view |
| Page delete/publish | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | — / — | — / — | — / ✓ | — / — |
| Review, posts, menus, media | — | — | — | — | — | — | — |
| Audit view/export | ✓ / ✓ | — / — | — / — | — / — | — / — | — / — | — / — |

Organization Administrator assignments are organization scoped and Site Administrator assignments site scoped. Other standard roles accept the supported explicit scope. Standard templates cannot be edited via the API; create a custom role to vary a template. Custom roles can be created/renamed/disabled and assigned registered capabilities, subject to non-escalating delegation rules. Platform-wide administration grants are not delegable.

## Management endpoint authorization map

| API endpoints | Required capability | Scope / prerequisite |
|---|---|---|
| `GET /api/admin/overview/` | `platform.dashboard.view` | Explicit platform scope; audited. |
| `/api/v1/authorization/permissions/` | `platform.roles.view` | Authenticated database assignment. |
| `/api/v1/authorization/roles/` list/retrieve | `platform.roles.view` | Role queryset limited to visible role templates/assignments. |
| Roles create, metadata patch, `/{code}/permissions/` PUT | `platform.roles.create`, `.update`, `.assign_permissions` | Custom roles only for writes; only registered active capabilities can be assigned. |
| `/api/v1/authorization/assignments/` list/create and revoke/scope | `platform.users.view` or `platform.users.assign_roles` | Actor cannot self-assign/self-revoke; grant set and target scope cannot exceed delegation. |
| `/api/v1/authorization/assignments/users/{id}/effective/` | `platform.users.view` | Target scope validated; non-admins can inspect only authorized users. |
| `/api/v1/authorization/me/permissions/` | authenticated identity | Self-only; requested scope must be assigned. |
| `/api/v1/authorization/audit/` | `audit.logs.view` | Event queryset restricted to authorized subjects/scopes. |
| `/api/v1/organizations/`, hierarchy actions | `platform.organizations.view` | Organization subtree queryset filtering. |
| Organization create | `platform.organizations.create` | Existing parent scope (root is platform only); legacy development write gate also remains. |
| Organization patch/lifecycle | `platform.organizations.update` | Existing organization scope; ETag and hierarchy/lifecycle checks; legacy development write gate remains. |
| `/api/v1/sites/` and nested `domains/`, `modules/` | `sites.view`, `sites.create`, `sites.update` | Site/organization subtrees; nested writes resolve parent Site from URL; legacy development write gate remains. |
| `/api/v1/site-templates/`, `/api/v1/modules/` | `platform.sites.manage_registry` | Platform-only registry actions; legacy development write gate remains on writes. |
| `GET /api/pages/`, detail, `/home/` | public published content | Unpublished pages are excluded; no read query scope currently exists in the legacy endpoint. |
| Page create/update/delete | `content.pages.create`, `.update`, `.delete` | Unscoped for legacy pages, otherwise resolved Site scope. Publishing is checked separately when `is_published` is supplied. |
| `/api/v1/site-context/` | public routing context | Reports the Site chosen by Host; is not an authorization decision. |

`GET /api/schema/`, `/api/docs/`, and `/api/redoc/` follow the existing documentation policy and are not management data endpoints. Every protected capability check and every role/assignment configuration mutation is recorded in the append-only authorization audit model. API authorization responses are private/no-store.

## Module prerequisites and limitations

The existing Site API still has a development-only write gate in addition to RBAC. Therefore valid scoped permissions do not yet enable production Site or Organization mutations: removing that operational freeze requires a separately approved deployment/readiness change. The backend has no Post, Menu, Media, Review workflow, content revision, or audit export endpoint; those catalog entries do not create phantom access. Public Site resolution continues to use the request Host, but the current Pages model has only optional Site ownership and page URLs are not Site-namespaced.

Authorization administration APIs are documented in generated OpenAPI. No Azure DevOps Issue/PR links or test evidence attachments are created by this repository change; attach them in the project backlog/PR workflow after review.
