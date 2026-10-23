"""Django discovers registrations through this package."""
from .organization_type import OrganizationTypeAdmin
from .organization_unit import OrganizationUnitAdmin

__all__ = ["OrganizationTypeAdmin", "OrganizationUnitAdmin"]
