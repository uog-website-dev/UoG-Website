"""One versioned draft and published navigation assignment per Site/slot."""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from apps.sites.menu_locations import MENU_SLOTS,locations_for_site
from .menu_models import require_menus_module

class MenuLocationAssignment(models.Model):
    site=models.ForeignKey('sites.Site',on_delete=models.PROTECT,related_name='menu_assignments')
    location=models.CharField(max_length=16,choices=tuple(MENU_SLOTS.items()))
    draft_menu=models.ForeignKey('cms.Menu',null=True,blank=True,on_delete=models.PROTECT,related_name='draft_assignments')
    published_menu=models.ForeignKey('cms.Menu',null=True,blank=True,on_delete=models.PROTECT,related_name='published_assignments')
    is_published=models.BooleanField(default=False)
    version=models.PositiveIntegerField(default=1)
    updated_by=models.ForeignKey(settings.AUTH_USER_MODEL,null=True,on_delete=models.SET_NULL,related_name='+')
    updated_at=models.DateTimeField(auto_now=True)
    class Meta:
        constraints=[models.UniqueConstraint(fields=['site','location'],name='menu_assignment_site_location'),models.CheckConstraint(condition=models.Q(location__in=tuple(MENU_SLOTS)),name='menu_assignment_location')]
    def clean(self):
        require_menus_module(self.site_id)
        if self.location not in locations_for_site(self.site):
            raise ValidationError({'location':'This location is not supported by the Site template.'})
        for field in ('draft_menu','published_menu'):
            menu=getattr(self,field)
            if menu and (menu.site_id!=self.site_id or menu.is_global):
                raise ValidationError({field:'Choose a local menu owned by this Site.'})
    def save(self,*args,**kwargs):
        from apps.organizations.hierarchy_lock import hierarchy_write
        with hierarchy_write():
            self.full_clean()
            result=super().save(*args,**kwargs)
            self.refresh_from_db(fields=['version','updated_at'])
            return result
