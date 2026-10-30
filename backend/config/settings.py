"""
Django settings for the UoG Digital Platform backend.

All configuration is environment-driven (python-decouple). See .env.example
at the repository root for the full list of supported variables.
"""
import sys
from pathlib import Path

from corsheaders.defaults import default_headers
from decouple import Csv, config

BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------
SECRET_KEY = config("SECRET_KEY", default="django-insecure-dev-only-change-me")
DEBUG = config("DEBUG", default=True, cast=bool)
ALLOWED_HOSTS = config(
    "ALLOWED_HOSTS", default="localhost,127.0.0.1,backend", cast=Csv()
)
# The browser Host header selects a Site. Client X-Forwarded-Host is ignored.
USE_X_FORWARDED_HOST = False
# Host-only cookies. A parent domain would share a session across websites.
SESSION_COOKIE_DOMAIN = None
CSRF_COOKIE_DOMAIN = None

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "drf_spectacular_sidecar",
    "corsheaders",
    "apps.core",
    "apps.api",
    "apps.accounts",
    "apps.audit",
    "apps.authorization",
    # Organization and Site administration consume the authorization domain.
    "apps.organizations",
    # Digital properties are a separate domain from institutional units.
    "apps.sites",
    # Site-scoped content primitives shared by Pages/Posts (P2-CMS-001).
    # Registry codes only; no content endpoints ship with this boundary.
    "apps.cms",
]

# Backstop for the test runner: when pytest imports a test module that itself
# imports app models, the module-level import must not raise
# ImproperlyConfigured because Django settings were never configured.
if "pytest" in sys.modules:
    def _ensure_test_settings():
        from django.conf import settings as _settings

        if not hasattr(_settings, "INSTALLED_APPS") or not _settings.configured:
            _settings.configure(
                INSTALLED_APPS=list(INSTALLED_APPS),
                DATABASES={},
                DATABASES_DEFAULT_TEST_BACKEND=None,
            )

    import atexit

    atexit.register(_ensure_test_settings)

MIDDLEWARE = [
    "apps.core.middleware.RequestIDMiddleware",
    "apps.sites.middleware.SiteResolutionMiddleware",
    "apps.audit.middleware.AuditContextMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# ---------------------------------------------------------------------------
# Database — ONE shared PostgreSQL database and schema for the whole platform
# (35+ institutional websites are scoped by Organization/Site rows added in
# later stories; per-site databases or schemas are explicitly out of scope).
#
# Privilege separation (approved P0 security architecture):
#   * the runtime connects as the non-superuser application role (DB_USER)
#   * migrations run as a separate migration role (DB_MIGRATE_USER), which
#     owns the schema and grants privileges to the application role
#     (see infrastructure/postgres/init and backend/entrypoint.sh).
# Credentials come exclusively from the environment — never from source.
# ---------------------------------------------------------------------------
DATABASES = {
    "default": {
        "ENGINE": config("DB_ENGINE", default="django.db.backends.postgresql"),
        "NAME": config("DB_NAME", default="uog_db"),
        "USER": config("DB_USER", default="uog_app"),
        "PASSWORD": config("DB_PASSWORD", default="uog_app_password"),
        "HOST": config("DB_HOST", default="postgres"),
        "PORT": config("DB_PORT", default="5432", cast=int),
        "CONN_MAX_AGE": config("DB_CONN_MAX_AGE", default=60, cast=int),
        "OPTIONS": {"connect_timeout": 5},
        "ATOMIC_REQUESTS": False,
    }
}

# The test suite creates and drops a temporary database (`test_<DB_NAME>`),
# which is a database-level DDL action. It therefore connects with the
# migration role — the runtime role above must never be able to create
# databases. Detected for both `pytest` and `manage.py test`.
if "pytest" in sys.modules or "test" in sys.argv:
    DATABASES["default"]["USER"] = config("DB_MIGRATE_USER", default="uog_migrate")
    DATABASES["default"]["PASSWORD"] = config(
        "DB_MIGRATE_PASSWORD", default="uog_migrate_password"
    )

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

# ---------------------------------------------------------------------------
# Internationalisation — UTF-8 database (PostgreSQL default) and UTC everywhere
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# Static files / media.
# NOTE: platform media and documents live in MinIO (see STORAGES below);
# MEDIA_ROOT is kept only for incidental local scratch storage.
# Under /api/ so the existing API proxy reaches Django. /static/ belongs to the public site.
STATIC_URL = "/api/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------------------
# Django REST Framework
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.errors.api_exception_handler",
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    # The Keycloak bearer authentication comes first so that unauthenticated
    # calls answer 401 (with a WWW-Authenticate challenge) instead of 403.
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.KeycloakBearerAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
}

# Public in development; production documentation is disabled unless explicitly
# enabled, in which case all three views require an active staff identity.
API_DOCS_ENABLED = config("API_DOCS_ENABLED", default=DEBUG, cast=bool)
ORGANIZATIONS_DEV_WRITES_ENABLED = config("ORGANIZATIONS_DEV_WRITES_ENABLED", default=False, cast=bool)
SPECTACULAR_SETTINGS = {
    "TITLE": "University of Gondar Digital Platform API",
    "VERSION": "1.0.0",
    "OAS_VERSION": "3.0.3",
    "DESCRIPTION": (
        "Live documentation generated from registered DRF endpoints and serializers. "
        "Use Authorize with a Keycloak access token (paste the JWT without Bearer). "
        "Backend authentication and permissions always apply. "
        "Organization administration is platform-admin only; writes require development "
        "opt-in and remain disabled in production pending scoped IAM/RBAC. "
        "CMS workflow and revision history require Site-scoped AUTHOR, REVIEWER or PUBLISHER "
        "assignments or the validated platform-admin token role; revision restore is AUTHOR-only "
        "and assignment management is platform-admin only. "
        "Site, domain, template and module administration is platform-admin only and uses the "
        "same development write opt-in; production writes remain disabled pending scoped IAM/RBAC. "
        "Posts and Menus content APIs are absent. "
        "No scope header grants access. See docs/development/api-documentation.md."
    ),
    "SERVE_INCLUDE_SCHEMA": False,
    "SERVE_PERMISSIONS": ["apps.core.permissions.DocumentationPermission"],
    "SWAGGER_UI_DIST": "SIDECAR",
    "SWAGGER_UI_FAVICON_HREF": "SIDECAR",
    "REDOC_DIST": "SIDECAR",
    "SWAGGER_UI_SETTINGS": {
        "deepLinking": True,
        "persistAuthorization": False,
        "validatorUrl": None,
    },
    "REDOC_UI_SETTINGS": {"disableGoogleFont": True},
    "COMPONENT_SPLIT_REQUEST": True,
    "ENUM_NAME_OVERRIDES": {
        "ContentStatusEnum": "apps.cms.models.ContentStatus",
        "PublishedContentStatusEnum": ["PUBLISHED"],
        "OrganizationStatusEnum": "apps.organizations.models.OrganizationUnit.Status",
        "SiteStatusEnum": "apps.sites.models.Site.Status",
        "ActiveInactiveStatusEnum": "apps.sites.models.SiteDomain.Status",
        "ModuleStatusEnum": "apps.sites.models.Module.Status",
        "CMSContentStatusEnum": "apps.cms.models.ContentStatus",
    },
    "POSTPROCESSING_HOOKS": [
        "drf_spectacular.hooks.postprocess_schema_enums",
        "apps.core.openapi.add_common_contract",
    ],
    "TAGS": [
        {"name": "CMS", "description": "Site-scoped page content primitives; public serving remains disabled."},
        {"name": "CMS workflow", "description": "Site-scoped roles, review/publishing workflow, immutable revision history and safe restore."},
        {"name": "Identity", "description": "Keycloak identity and platform administration."},
        {"name": "Organizations", "description": "Restricted institutional administration; production writes disabled pending scoped IAM/RBAC."},
        {"name": "Sites", "description": "Restricted Site, configuration and per-site module administration."},
        {"name": "Domains", "description": "Hostnames for one Site, including an atomic primary-domain switch."},
        {"name": "Site templates", "description": "Approved starting configurations. Applying one does not rewrite existing Sites."},
        {"name": "Modules", "description": "Platform capability registry. Planned modules cannot be enabled for a Site."},
        {"name": "Posts", "description": "Not implemented."},
        {"name": "Menus", "description": "Site-scoped menu and item administration, atomic tree operations, inheritance policy and menu-wide ETag concurrency. Permissions: menu.read, menu.write and menu.publish. Inheritance does not grant parent-menu management."},
        {"name": "Public menus", "description": "Effective navigation for the Site resolved from the trusted Host. Global, inherited and local items follow the Site delivery policy."},
    ],
}

# ---------------------------------------------------------------------------
# Keycloak / OIDC — the API validates the access tokens the frontends obtain
# from the identity provider (see apps.accounts).
#
# OIDC_ISSUER is the *public* issuer Keycloak stamps into its tokens (the
# address the browser uses); OIDC_JWKS_URL may point at an internal address
# because the containers reach Keycloak over the Docker network.
# ---------------------------------------------------------------------------
OIDC_ISSUER = config(
    "OIDC_ISSUER", default="http://localhost:8080/realms/uog"
)
OIDC_JWKS_URL = config(
    "OIDC_JWKS_URL",
    default="http://keycloak:8080/realms/uog/protocol/openid-connect/certs",
)
# The audience a token must carry — tokens are issued for the platform API.
OIDC_AUDIENCE = config("OIDC_AUDIENCE", default="backend-api", cast=Csv())
# The clients whose tokens are accepted (the "azp" claim).
OIDC_ALLOWED_CLIENTS = config(
    "OIDC_ALLOWED_CLIENTS",
    default="public-web,admin-web,backend-api",
    cast=Csv(),
)
# Only asymmetric algorithms — a shared secret would let anybody mint tokens.
OIDC_ALLOWED_ALGORITHMS = config(
    "OIDC_ALLOWED_ALGORITHMS", default="RS256", cast=Csv()
)
OIDC_LEEWAY_SECONDS = config("OIDC_LEEWAY_SECONDS", default=30, cast=int)
OIDC_JWKS_CACHE_SECONDS = config("OIDC_JWKS_CACHE_SECONDS", default=300, cast=int)
OIDC_HTTP_TIMEOUT_SECONDS = config("OIDC_HTTP_TIMEOUT_SECONDS", default=10, cast=int)
# Keycloak roles that make a local account a staff account.
OIDC_STAFF_ROLES = config("OIDC_STAFF_ROLES", default="platform-admin", cast=Csv())

# Authorization-related caching — separate keys/timers from general app cache.
# Token-to-user identity mapping is intentionally NOT cached here; that is
# owned by the OIDC authentication layer's own JWKS state. Authorization
# decisions themselves are write-through to the database and may incur cache
# only where explicitly documented (e.g. site/user-scoped assignment lookups
# in apps.authorization.access). No client-supplied header or claim may pin
# an authorization outcome in this cache.
AUTH_SCOPE_CACHE_PREFIX = config("AUTH_SCOPE_CACHE_PREFIX", default="auth-scope")
AUTH_SCOPE_CACHE_TIMEOUT_SECONDS = config("AUTH_SCOPE_CACHE_TIMEOUT_SECONDS", default=60, cast=int)
AUTH_EFFECTIVE_PERMISSIONS_CACHE_PREFIX = config("AUTH_EFFECTIVE_PERMISSIONS_CACHE_PREFIX", default="auth-effective-perms")
AUTH_EFFECTIVE_PERMISSIONS_CACHE_TIMEOUT_SECONDS = config("AUTH_EFFECTIVE_PERMISSIONS_CACHE_TIMEOUT_SECONDS", default=60, cast=int)
AUTH_LIVE_ASSIGNMENTS_CACHE_PREFIX = config("AUTH_LIVE_ASSIGNMENTS_CACHE_PREFIX", default="auth-live-assignments")
AUTH_LIVE_ASSIGNMENTS_CACHE_TIMEOUT_SECONDS = config("AUTH_LIVE_ASSIGNMENTS_CACHE_TIMEOUT_SECONDS", default=60, cast=int)
AUTH_REVOCATION_LAG_SECONDS = config("AUTH_REVOCATION_LAG_SECONDS", default=120, cast=int)

# ---------------------------------------------------------------------------
# CORS — Next.js dev servers (public-web :3000, admin-web :3001) and nginx
# ---------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = config(
    "CORS_ALLOWED_ORIGINS",
    default="http://localhost:3000,http://localhost:3001,http://localhost",
    cast=Csv(),
)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [*default_headers, "x-request-id", "if-match"]
CORS_EXPOSE_HEADERS = ["X-Request-ID", "ETag", "Location"]

# ---------------------------------------------------------------------------
# Redis cache (redis-cache instance).
# Cache keys carry a prefix and go through a custom key function, leaving a
# documented extension point for future organization/site scoping
# (see apps.core.cache.make_cache_key). Redis is a cache/broker ONLY — never
# authoritative institutional storage.
# ---------------------------------------------------------------------------
REDIS_CACHE_HOST = config("REDIS_CACHE_HOST", default="redis-cache")
REDIS_CACHE_PORT = config("REDIS_CACHE_PORT", default=6379, cast=int)
REDIS_CACHE_DB = config("REDIS_CACHE_DB", default=0, cast=int)
CACHE_KEY_PREFIX = config("CACHE_KEY_PREFIX", default="uog")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": f"redis://{REDIS_CACHE_HOST}:{REDIS_CACHE_PORT}/{REDIS_CACHE_DB}",
        "KEY_PREFIX": CACHE_KEY_PREFIX,
        "KEY_FUNCTION": "apps.core.cache.make_cache_key",
        "TIMEOUT": config("CACHE_TIMEOUT", default=300, cast=int),
    }
}

# ---------------------------------------------------------------------------
# Celery — dedicated broker Redis (redis-broker instance) so cache eviction
# can never drop queued tasks. Broker and results use separate DB indexes.
# ---------------------------------------------------------------------------
CELERY_BROKER_URL = config(
    "CELERY_BROKER_URL", default="redis://redis-broker:6379/0"
)
CELERY_RESULT_BACKEND = config(
    "CELERY_RESULT_BACKEND", default="redis://redis-broker:6379/1"
)
CELERY_TIMEZONE = "UTC"
CELERY_ENABLE_UTC = True
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_DEFAULT_RETRY_DELAY = 10
# Task failures and retries are logged centrally (apps.core.apps handlers).

# ---------------------------------------------------------------------------
# MinIO object storage (S3-compatible).
# Approved buckets: platform-public, platform-private, platform-documents.
# They are created once by the minio-init service — never one bucket per site.
# Credentials come from the environment only.
# ---------------------------------------------------------------------------
AWS_S3_ENDPOINT_URL = config("MINIO_ENDPOINT", default="http://minio:9000")
AWS_ACCESS_KEY_ID = config("MINIO_ACCESS_KEY", default="uog_minio_admin")
AWS_SECRET_ACCESS_KEY = config("MINIO_SECRET_KEY", default="minio_dev_secret_change_me")
AWS_S3_REGION_NAME = config("MINIO_REGION", default="us-east-1")
AWS_DEFAULT_ACL = None
AWS_QUERYSTRING_AUTH = True  # signed URLs for private objects
AWS_S3_SIGNATURE_VERSION = "s3v4"
AWS_S3_ADDRESSING_STYLE = "path"
AWS_S3_USE_SSL = config("MINIO_USE_SSL", default=False, cast=bool)
AWS_STORAGE_BUCKET_NAME = config("MINIO_BUCKET", default="platform-private")

STORAGES = {
    "default": {
        "BACKEND": "storages.backends.s3.S3Storage",
    },
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}

# ---------------------------------------------------------------------------
# Logging — console output for containers; task failure/retry visibility
# ---------------------------------------------------------------------------
LOG_LEVEL = config("LOG_LEVEL", default="INFO")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {
            "format": "%(asctime)s %(levelname)s [%(name)s] %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "standard",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": LOG_LEVEL,
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        "apps": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        "celery": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
    },
}

# Public in development; production documentation is disabled unless explicitly
# enabled, in which case all three views require an active staff identity.
API_DOCS_ENABLED = config("API_DOCS_ENABLED", default=DEBUG, cast=bool)
ORGANIZATIONS_DEV_WRITES_ENABLED = config("ORGANIZATIONS_DEV_WRITES_ENABLED", default=False, cast=bool)

# ------------------------------------------------------------------
# drf-spectacular documentation (installed in this project's base deps).
# ------------------------------------------------------------------
SPECTACULAR_SETTINGS = {
    "TITLE": "University of Gondar Digital Platform API",
    "VERSION": "1.0.0",
    "OAS_VERSION": "3.0.3",
    "DESCRIPTION": (
        "Live documentation generated from registered DRF endpoints and serializers. "
        "Use Authorize with a Keycloak access token (paste the JWT without Bearer). "
        "Backend permissions are resolved from registered database capabilities and scoped role assignments; "
        "Keycloak claims authenticate identities only. Protected management APIs require the explicit "
        "database platform-administrator assignment or a matching scoped application permission. "
        "No scope header grants access. Content capabilities without an API/workflow are not enabled."
    ),
    "SERVE_INCLUDE_SCHEMA": False,
    "SERVE_PERMISSIONS": ["apps.core.permissions.DocumentationPermission"],
    "SWAGGER_UI_DIST": "SIDECAR",
    "SWAGGER_UI_FAVICON_HREF": "SIDECAR",
    "REDOC_DIST": "SIDECAR",
    "SWAGGER_UI_SETTINGS": {
        "deepLinking": True,
        "persistAuthorization": False,
        "validatorUrl": None,
    },
    "REDOC_UI_SETTINGS": {"disableGoogleFont": True},
    "COMPONENT_SPLIT_REQUEST": True,
    "ENUM_NAME_OVERRIDES": {
        "ContentStatusEnum": "apps.cms.models.ContentStatus",
        "PublishedContentStatusEnum": ["PUBLISHED"],
        "OrganizationStatusEnum": "apps.organizations.models.OrganizationUnit.Status",
        "SiteStatusEnum": "apps.sites.models.Site.Status",
        "ActiveInactiveStatusEnum": "apps.sites.models.SiteDomain.Status",
        "ModuleStatusEnum": "apps.sites.models.Module.Status",
        "SiteTemplateStatusEnum": "apps.sites.models.SiteTemplate.Status",
        "ContentStatusEnum": "apps.cms.models.ContentStatus",
    },
    "POSTPROCESSING_HOOKS": [
        "drf_spectacular.hooks.postprocess_schema_enums",
        "apps.core.openapi.add_common_contract",
    ],
    "TAGS": [
        {"name": "CMS", "description": "Platform page endpoints authorized by registered application permissions."},
        {"name": "Identity", "description": "Keycloak identity and platform administration."},
        {"name": "Authorization", "description": "Database-backed application roles, registered permissions, scoped assignments and authorization audit history."},
        {"name": "Authorization", "description": "Registered permissions, application roles, scoped user assignments and audit history."},
        {"name": "Organizations", "description": "Institutional administration authorized by scoped application permissions."},
        {"name": "Sites", "description": "Site, configuration and per-site module administration authorized by scoped application permissions."},
        {"name": "Domains", "description": "Hostnames for one Site, including an atomic primary-domain switch."},
        {"name": "Site templates", "description": "Approved starting configurations. Applying one does not rewrite existing Sites."},
        {"name": "Modules", "description": "Platform capability registry. Planned modules cannot be enabled for a Site."},
        {"name": "Menu links", "description": "Site menu-link administration authorized by scoped application permissions."},
        {"name": "Posts", "description": "Not implemented."},
        {"name": "Menus", "description": "Site-scoped menu and item administration, atomic tree operations, inheritance policy and menu-wide ETag concurrency. Permissions: menu.read, menu.write and menu.publish. Inheritance does not grant parent-menu management."},
        {"name": "Public menus", "description": "Effective navigation for the Site resolved from the trusted Host. Global, inherited and local items follow the Site delivery policy."},
    ],
}

# ------------------------------------------------------------------
# Documentation endpoints are explicitly disabled when the public site serves
# API docs for a Site. The public-web ProxyPass already forwards requests under
# /api/ to the backend, so any path that Django would document as a management
# endpoint must be unregistered there to avoid accidental exposure.
# ------------------------------------------------------------------
if False:
    # Kept as a documented no-op extension point. If the project later decides
    # to serve the same backend schema under a public Site path, both views and
    # their URL entries must be removed from config/urls.py as well.
    pass
