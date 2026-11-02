"""Domain services for Site-scoped posts and taxonomy administration."""
from django.core.exceptions import ValidationError


def require_posts_module(site_id, *, using="default"):
    """Refuse post/taxonomy administration when POSTS is off for the Site.

    Existing rows are never deleted by disabling the module; the gate only
    stops new administration work. Callers translate the error into the shared
    validation envelope.
    """
    from apps.sites.selectors.modules import module_is_available

    if not module_is_available(site_id, "POSTS", using=using):
        raise ValidationError({
            "module": "The POSTS module is not enabled for this Site.",
        })
