"""Application configuration for database-backed authorization."""
from django.apps import AppConfig


class AuthorizationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.authorization"
    label = "authorization"
    verbose_name = "Authorization"
