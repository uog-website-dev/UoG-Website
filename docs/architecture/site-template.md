# Site templates

Implementation date: 2026-10-27. A SiteTemplate is an approved starting
point for a website. It is data: University Main Site, College, Research
Center, Directorate, Administrative Unit and General Institutional Site are
seeded rows, not branches in application code. An administrator can add
another template by creating a row. No deploy is required for that name.

## Fields

| Field | Contract |
| --- | --- |
| code | Globally unique uppercase code, immutable after creation |
| name | Required nonblank name |
| description | Required nonblank description of the kind of website |
| status | `ACTIVE` or `INACTIVE`. New rows start `INACTIVE`. The seeded catalog is `ACTIVE`. |
| default_configuration | The same versioned allowlist as [site configuration](site-configuration.md). Empty documents become schema version 1 defaults. |
| created_at / updated_at | Timezone-aware automatic timestamps |

`Site.template` is a nullable protected FK. It records which template was
selected. It is not a live binding.

## What is copied

`provision_site` creates one Site. When an active template is selected and
the caller does not supply a configuration document, the template's
`default_configuration` is deep-copied onto that Site. The Site's
`default_language` is added to the copied enabled-language list when it is
missing and the list has room. An explicit configuration document is merged
onto that copy with the same allowlist rules as `apply_site_configuration`.
Creating a Site through the model with an active template and no explicit
document performs the same copy, so Django admin follows the same rule.

The copy is the Site's own configuration. Changing a template's defaults,
deactivating it, or pointing an existing Site at a different active template
does not replace that Site's configuration. Deactivating a template also
leaves the existing FK in place. An inactive template cannot be selected for
a new Site or assigned in place of the current one. Database triggers reject
the same selection if it bypasses the model, and they reject template
documents that do not match the configuration schema.

## Deferred on purpose

Provisioning does not enable modules. The [module registry](module-registry.md)
decides which shipped capabilities a Site may turn on. Layout defaults and
CMS page generation are not part of this model. Templates are administered at
`/api/v1/site-templates/`. See the [Site API contract](../api/sites.md).
