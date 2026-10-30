"""Reviewed executable capabilities and repeatable standard role templates.

Adding a catalog entry is a code-reviewed capability change; enabling role
assignments at runtime never creates new executable operations.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Capability:
    code: str
    name: str
    description: str
    module: str
    resource_type: str
    action: str
    risk: str = "LOW"
    delegable: bool = True


CAPABILITIES = (
    Capability("platform.dashboard.view", "View platform dashboard", "Read platform aggregate overview.", "platform", "dashboard", "view", "HIGH", False),
    Capability("platform.sites.manage_registry", "Manage global site registry", "Manage global site templates and module capabilities.", "sites", "registry", "manage", "CRITICAL", False),
    Capability("platform.organizations.view", "View organizations", "Read OrganizationUnit administration records.", "organizations", "organization", "view"),
    Capability("platform.organizations.create", "Create organizations", "Create institutional OrganizationUnits.", "organizations", "organization", "create", "HIGH", False),
    Capability("platform.organizations.update", "Update organizations", "Update and transition OrganizationUnits.", "organizations", "organization", "update", "HIGH", False),
    Capability("platform.users.view", "View users", "Inspect platform user identities.", "users", "user", "view"),
    Capability("platform.users.assign_roles", "Assign user roles", "Grant and revoke scoped application roles.", "users", "role_assignment", "manage", "CRITICAL", False),
    Capability("platform.roles.view", "View roles", "Read application roles and their permissions.", "roles", "role", "view"),
    Capability("platform.roles.create", "Create roles", "Create eligible custom roles.", "roles", "role", "create", "HIGH", False),
    Capability("platform.roles.update", "Update roles", "Update eligible custom role metadata/status.", "roles", "role", "update", "HIGH", False),
    Capability("platform.roles.assign_permissions", "Assign role permissions", "Set permissions on eligible custom roles.", "roles", "role_permission", "manage", "CRITICAL", False),
    Capability("sites.view", "View sites", "Read Site, domain, module and template administration.", "sites", "site", "view"),
    Capability("sites.create", "Create sites", "Create a Site.", "sites", "site", "create", "HIGH", False),
    Capability("sites.update", "Update sites", "Update Site settings, domains, modules and lifecycle.", "sites", "site", "update", "HIGH", False),
    Capability("content.pages.view", "View pages", "Read published pages and administer pages within assigned site scope.", "content", "page", "view"),
    Capability("content.pages.create", "Create pages", "Create unpublished pages within assigned site scope.", "content", "page", "create"),
    Capability("content.pages.update", "Update pages", "Edit pages within assigned site scope.", "content", "page", "update"),
    Capability("content.pages.submit_review", "Submit pages for review", "Submit a page into review. Not executable: no review workflow exists.", "content", "page", "submit_review", "HIGH", False),
    Capability("content.pages.approve", "Approve pages", "Approve a page review. Not executable: no review workflow exists.", "content", "page", "approve", "HIGH", False),
    Capability("content.posts.view", "View posts", "Read posts. Not executable: no posts model or endpoint exists.", "content", "post", "view"),
    Capability("content.posts.create", "Create posts", "Create posts. Not executable: no posts model or endpoint exists.", "content", "post", "create"),
    Capability("content.posts.update", "Update posts", "Edit posts. Not executable: no posts model or endpoint exists.", "content", "post", "update"),
    Capability("content.posts.delete", "Delete posts", "Delete posts. Not executable: no posts model or endpoint exists.", "content", "post", "delete", "HIGH", False),
    Capability("content.posts.submit_review", "Submit posts for review", "Submit a post for review. Not executable: no posts workflow exists.", "content", "post", "submit_review", "HIGH", False),
    Capability("content.posts.approve", "Approve posts", "Approve posts. Not executable: no posts workflow exists.", "content", "post", "approve", "HIGH", False),
    Capability("content.posts.publish", "Publish posts", "Publish posts. Not executable: no posts model or endpoint exists.", "content", "post", "publish", "HIGH", False),
    Capability("content.menus.view", "View menus", "Read menus. Not executable: no menus model or endpoint exists.", "content", "menu", "view"),
    Capability("content.menus.manage", "Manage menus", "Manage menus. Not executable: no menus model or endpoint exists.", "content", "menu", "manage", "HIGH", False),
    Capability("content.media.view", "View media", "Read media. Not executable: no media API exists.", "content", "media", "view"),
    Capability("content.media.upload", "Upload media", "Upload media. Not executable: no media API exists.", "content", "media", "upload", "HIGH", False),
    Capability("content.media.delete", "Delete media", "Delete media. Not executable: no media API exists.", "content", "media", "delete", "HIGH", False),
    Capability("content.pages.delete", "Delete pages", "Delete pages in the current API; no review workflow state exists.", "content", "page", "delete", risk="HIGH", delegable=False),
    Capability("content.pages.publish", "Publish pages", "Set page publication state; the current model has no review prerequisite.", "content", "page", "publish", risk="HIGH", delegable=False),
    Capability("audit.logs.view", "View audit logs", "Inspect authorization and platform audit history.", "audit", "audit_event", "view", risk="HIGH", delegable=False),
    Capability("audit.logs.export", "Export audit logs", "Export audit history.", "audit", "audit_event", "export", risk="HIGH", delegable=False),
)

CAPABILITY_CODES = frozenset(item.code for item in CAPABILITIES)

PLATFORM_ADMIN = frozenset({
    "platform.dashboard.view", "platform.sites.manage_registry",
    "platform.organizations.view", "platform.organizations.create", "platform.organizations.update",
    "platform.users.view", "platform.users.assign_roles", "platform.roles.view", "platform.roles.create",
    "platform.roles.update", "platform.roles.assign_permissions", "sites.view", "sites.create", "sites.update",
    "content.pages.view", "content.pages.create", "content.pages.update", "content.pages.delete", "content.pages.publish",
    "audit.logs.view", "audit.logs.export",
})
ORG_ADMIN = frozenset({
    "platform.dashboard.view", "platform.organizations.view", "platform.organizations.update",
    "platform.users.view", "platform.users.assign_roles", "platform.roles.view", "sites.view", "sites.create", "sites.update",
    "content.pages.view", "content.pages.create", "content.pages.update",
    "content.pages.delete", "content.pages.publish",
})
SITE_ADMIN = frozenset({
    "platform.dashboard.view", "platform.users.view", "platform.users.assign_roles", "sites.view", "sites.update",
    "content.pages.view", "content.pages.create", "content.pages.update",
    "content.pages.delete", "content.pages.publish",
})
EDITOR = frozenset({
    "content.pages.view", "content.pages.create", "content.pages.update",
})
REVIEWER = frozenset({"content.pages.view"})
PUBLISHER = frozenset({"content.pages.view", "content.pages.publish"})
VIEWER = frozenset({
    "platform.dashboard.view", "platform.organizations.view", "platform.users.view", "platform.roles.view",
    "sites.view", "content.pages.view",
})

STANDARD_ROLES = (
    ("platform-administrator", "Platform Administrator", "Narrow platform-wide governance and audit authority.", PLATFORM_ADMIN),
    ("organization-administrator", "Organization Administrator", "Organization-scoped administration; does not grant cross-organization authority.", ORG_ADMIN),
    ("site-administrator", "Site Administrator", "Site-scoped administration; does not grant other-site authority.", SITE_ADMIN),
    ("editor", "Editor", "Create and edit content; cannot approve or publish.", EDITOR),
    ("reviewer", "Reviewer", "Read current content. No review workflow exists yet.", REVIEWER),
    ("publisher", "Publisher", "Publish content only where the workflow allows it.", PUBLISHER),
    ("viewer", "Viewer", "Read explicitly granted resources only.", VIEWER),
)


def capability_for(code):
    """Return registered capability or None; database-only codes never execute."""
    return next((capability for capability in CAPABILITIES if capability.code == code), None)
