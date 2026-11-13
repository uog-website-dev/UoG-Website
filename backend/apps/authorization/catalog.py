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
    Capability("menu.read", "Read menus", "Inspect menus and menu items within assigned Site scope.", "content", "menu", "read"),
    Capability("menu.write", "Write menus", "Create draft menus and edit menu structures within assigned Site scope.", "content", "menu", "write", "HIGH", False),
    Capability("menu.publish", "Publish menus", "Activate/deactivate menus and authorize edits to active menu structures.", "content", "menu", "publish", "HIGH", False),
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
    Capability("content.posts.view", "View posts", "Read posts within assigned Site scope.", "content", "post", "view"),
    Capability("content.posts.create", "Create posts", "Create draft posts within assigned Site scope.", "content", "post", "create"),
    Capability("content.posts.update", "Update posts", "Edit posts within assigned Site scope.", "content", "post", "update"),
    Capability("content.posts.delete", "Delete posts", "Delete posts within assigned Site scope.", "content", "post", "delete", "HIGH", False),
    Capability("content.posts.submit_review", "Submit posts for review", "Reserved. Post review uses a Site CMS author assignment, not this catalog code.", "content", "post", "submit_review", "HIGH", False),
    Capability("content.posts.approve", "Approve posts", "Reserved. Post approval uses a Site CMS reviewer assignment, not this catalog code.", "content", "post", "approve", "HIGH", False),
    Capability("content.posts.publish", "Publish posts", "Show the Posts section to a publisher. Publishing still requires the Site CMS publisher role.", "content", "post", "publish", "HIGH", False),
    Capability("content.menus.view", "View menus", "Legacy catalog record. Menu APIs require menu.read; this code is not an alias.", "content", "menu", "view"),
    Capability("content.menus.manage", "Manage menus", "Legacy catalog record. Menu APIs require menu.write/menu.publish; this code is not an alias.", "content", "menu", "manage", "HIGH", False),
    Capability("content.media.view", "View media", "Read Site-owned asset metadata and placement references.", "content", "media", "view"),
    Capability("content.media.upload", "Manage media", "Register stored objects, edit metadata and manage Page placement references in this Site.", "content", "media", "upload", "HIGH", False),
    Capability("content.media.delete", "Archive media", "Archive Site assets without deleting storage identity or references.", "content", "media", "delete", "HIGH", False),
    Capability("content.pages.delete", "Delete pages", "Delete pages in the current API; no review workflow state exists.", "content", "page", "delete", risk="HIGH", delegable=False),
    Capability("content.pages.publish", "Publish pages", "Set page publication state; the current model has no review prerequisite.", "content", "page", "publish", risk="HIGH", delegable=False),
    Capability("audit.logs.view", "View audit logs", "Inspect authorization and platform audit history.", "audit", "audit_event", "view", risk="HIGH", delegable=False),
    Capability("audit.logs.export", "Export audit logs", "Export audit history.", "audit", "audit_event", "export", risk="HIGH", delegable=False),
)

CAPABILITY_CODES = frozenset(item.code for item in CAPABILITIES)

PLATFORM_ADMIN = frozenset({
    "content.media.view", "content.media.upload", "content.media.delete",
    "menu.read", "menu.write", "menu.publish",
    "content.menus.view", "content.menus.manage",
    "platform.dashboard.view", "platform.sites.manage_registry",
    "platform.organizations.view", "platform.organizations.create", "platform.organizations.update",
    "platform.users.view", "platform.users.assign_roles", "platform.roles.view", "platform.roles.create",
    "platform.roles.update", "platform.roles.assign_permissions", "sites.view", "sites.create", "sites.update",
    "content.pages.view", "content.pages.create", "content.pages.update", "content.pages.delete", "content.pages.publish",
    "content.posts.view", "content.posts.create", "content.posts.update", "content.posts.delete", "content.posts.publish",
    "audit.logs.view", "audit.logs.export",
})
ORG_ADMIN = frozenset({
    "menu.read", "menu.write", "menu.publish",
    "content.menus.view", "content.menus.manage",
    "platform.dashboard.view", "platform.organizations.view", "platform.organizations.update",
    "platform.users.view", "platform.users.assign_roles", "platform.roles.view", "sites.view", "sites.create", "sites.update",
    "content.pages.view", "content.pages.create", "content.pages.update",
    "content.pages.delete", "content.pages.publish",
    "content.posts.view", "content.posts.create", "content.posts.update",
    "content.posts.delete", "content.posts.publish",
})
SITE_ADMIN = frozenset({
    "content.media.view", "content.media.upload", "content.media.delete",
    "menu.read", "menu.write", "menu.publish",
    "content.menus.view", "content.menus.manage",
    "platform.dashboard.view", "platform.users.view", "platform.users.assign_roles", "sites.view", "sites.update",
    "content.pages.view", "content.pages.create", "content.pages.update",
    "content.pages.delete", "content.pages.publish",
    "content.posts.view", "content.posts.create", "content.posts.update",
    "content.posts.delete", "content.posts.publish",
})
EDITOR = frozenset({
    "sites.view", "content.media.view", "content.media.upload",
    "menu.read", "menu.write",
    "content.menus.view",
    "content.pages.view", "content.pages.create", "content.pages.update",
    "content.posts.view", "content.posts.create", "content.posts.update",
})
REVIEWER = frozenset({"sites.view", "content.media.view", "content.pages.view", "content.posts.view", "menu.read"})
PUBLISHER = frozenset({
    "sites.view", "content.media.view",
    "content.pages.view", "content.pages.publish",
    "content.posts.view", "content.posts.publish",
    "menu.read", "menu.publish",
})
VIEWER = frozenset({
    "menu.read",
    "content.menus.view",
    "platform.dashboard.view", "platform.organizations.view", "platform.users.view", "platform.roles.view",
    "sites.view", "content.pages.view", "content.posts.view",
})

STANDARD_ROLES = (
    ("platform-administrator", "Platform Administrator", "Narrow platform-wide governance and audit authority.", PLATFORM_ADMIN),
    ("organization-administrator", "Organization Administrator", "Organization-scoped administration; does not grant cross-organization authority.", ORG_ADMIN),
    ("site-administrator", "Site Administrator", "Site-scoped administration; does not grant other-site authority.", SITE_ADMIN),
    ("editor", "Editor", "Create and edit content; cannot approve or publish.", EDITOR),
    ("reviewer", "Reviewer", "Read current content. Approval uses a Site CMS reviewer assignment.", REVIEWER),
    ("publisher", "Publisher", "Publish content only where the workflow allows it.", PUBLISHER),
    ("viewer", "Viewer", "Read explicitly granted resources only.", VIEWER),
)

# Roles a Site may grant through Site user management. Platform and organization
# administrators stay out of SITE scope and are managed only at their own scopes.
SITE_MEMBERSHIP_ROLE_CODES = frozenset({
    "site-administrator",
    "editor",
    "publisher",
    "reviewer",
    "viewer",
})


def capability_for(code):
    """Return registered capability or None; database-only codes never execute."""
    return next((capability for capability in CAPABILITIES if capability.code == code), None)
