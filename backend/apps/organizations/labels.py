"""Translation message IDs for the default presentation labels, not type choices.

The managed lookup is authoritative, including administrator-defined codes.
These labels only make the seeded English names discoverable by makemessages.
"""
from django.utils.translation import gettext_noop

DEFAULT_NAME_MESSAGES = (
    gettext_noop("University"),
    gettext_noop("College"),
    gettext_noop("School"),
    gettext_noop("Institute"),
    gettext_noop("Department"),
    gettext_noop("Research Center"),
    gettext_noop("Directorate"),
    gettext_noop("Office"),
    gettext_noop("Administrative Unit"),
    gettext_noop("Other"),
)
