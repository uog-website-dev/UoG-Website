"""Application registration for digital properties."""
from django.apps import AppConfig


class SitesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.sites"
    label = "sites"
    verbose_name = "Digital Sites"

    def ready(self):
        from .allowed_hosts import install_host_check
        install_host_check()
