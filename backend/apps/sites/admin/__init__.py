"""Digital Site admin registrations."""
from .module import ModuleAdmin, SiteModuleAdmin
from .site import SiteAdmin
from .site_domain import SiteDomainAdmin
from .site_template import SiteTemplateAdmin

__all__ = ["ModuleAdmin", "SiteAdmin", "SiteDomainAdmin", "SiteModuleAdmin", "SiteTemplateAdmin"]
