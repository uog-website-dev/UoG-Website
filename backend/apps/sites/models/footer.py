"""Site-owned footer presentation; navigation remains in published menus."""
from django.conf import settings
from django.db import models
from django.core.validators import RegexValidator

COPYRIGHT_DEFAULT = "\u00a9 {year} {site}. All rights reserved."

class SiteFooter(models.Model):
    site=models.OneToOneField("sites.Site",on_delete=models.CASCADE,related_name="footer_settings",primary_key=True)
    description=models.CharField(max_length=600,blank=True,default="")
    address=models.CharField(max_length=300,blank=True,default="")
    email=models.EmailField(blank=True,default="")
    phone=models.CharField(max_length=48,blank=True,default="",validators=[RegexValidator(r"^\+?[0-9][0-9(). -]{3,47}$","Enter a valid telephone number.")])
    links_heading=models.CharField(max_length=80,default="Explore")
    highlight_label=models.CharField(max_length=80,blank=True,default="")
    highlight_url=models.URLField(max_length=2048,blank=True,default="")
    newsletter_label=models.CharField(max_length=120,blank=True,default="")
    newsletter_url=models.URLField(max_length=2048,blank=True,default="")
    support_label=models.CharField(max_length=120,blank=True,default="")
    support_url=models.URLField(max_length=2048,blank=True,default="")
    copyright_text=models.CharField(max_length=300,default=COPYRIGHT_DEFAULT)
    social_links=models.JSONField(default=list,blank=True)
    version=models.PositiveIntegerField(default=1,editable=False)
    created_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.SET_NULL,null=True,related_name="+",editable=False)
    updated_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.SET_NULL,null=True,related_name="+",editable=False)
    created_at=models.DateTimeField(auto_now_add=True)
    updated_at=models.DateTimeField(auto_now=True)

    @classmethod
    def from_db(cls,db,field_names,values):
        instance=super().from_db(db,field_names,values)
        instance._original_site_id=instance.site_id
        return instance

    def clean(self):
        from apps.sites.footer import validate_footer
        validate_footer({field:getattr(self,field) for field in FOOTER_FIELDS})

    def save(self,*args,**kwargs):
        from apps.organizations.hierarchy_lock import hierarchy_write
        from apps.audit.context import database_audit_context
        with hierarchy_write(),database_audit_context():
            from django.core.exceptions import ValidationError
            if not self._state.adding and getattr(self,"_original_site_id",self.site_id)!=self.site_id:
                raise ValidationError({"site":"Footer ownership cannot be reassigned."})
            self.full_clean()
            super().save(*args,**kwargs)
            self.refresh_from_db(fields=["version"])

FOOTER_FIELDS=("newsletter_label","newsletter_url","support_label","support_url","description","address","email","phone","links_heading","highlight_label","highlight_url","copyright_text","social_links")
