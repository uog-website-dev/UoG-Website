"""Site-owned visitor inquiries accepted by a published Contact Form widget."""
import uuid

from django.db import models


class ContactSubmission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey("sites.Site", on_delete=models.PROTECT)
    page = models.ForeignKey("cms.Page", on_delete=models.PROTECT)
    form_code = models.CharField(max_length=128)
    request_id = models.UUIDField()
    name = models.CharField(max_length=200)
    email = models.EmailField(max_length=254)
    message = models.TextField(max_length=5000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("site", "request_id"), name="cms_contact_request_uniq")]
        indexes = [models.Index(fields=("site", "-created_at"), name="cms_contact_site_created_idx")]
