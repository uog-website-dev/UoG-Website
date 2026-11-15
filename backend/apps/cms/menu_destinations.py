"""Shared menu destination eligibility. Never return private target metadata."""
from types import SimpleNamespace
from django.utils import timezone
from django.core.exceptions import ValidationError
from apps.sites.selectors.modules import module_is_available
from .models import ContentStatus, Page, PublishedContentSnapshot, Visibility
from .menu_models import validate_external_url, CUSTOM_PATH

SNAPSHOT_FIELDS = ('id','site_id','label','item_type','page_id','post_id','category_id','target','parent_id','sort_order','is_active','allow_cross_site')

def snapshot_items(menu):
    return [{key: str(value) if value is not None and (key.endswith('_id') and key != 'site_id' or key == 'id') else value for key,value in row.items()} for row in menu.items.order_by('sort_order','id').values(*SNAPSHOT_FIELDS)]

def published_rows(menu):
    if menu.published_items is None:  # Trusted legacy system-created menus, until first publication.
        return list(menu.items.order_by('sort_order','id'))
    return [SimpleNamespace(**{key: int(value) if key == 'site_id' else value for key,value in row.items()},pk=row['id']) for row in menu.published_items]

def resolve_destination(item):
    from apps.api.models import Post, Category
    kind = item.item_type
    if kind in {'external','custom'}:
        try:
            if kind == 'external': validate_external_url(item.target)
            elif not CUSTOM_PATH.fullmatch(item.target): return None
        except (ValidationError,TypeError): return None
        return item.target
    if kind not in {'page','post','news','category'}: return None
    module = 'PAGES' if kind == 'page' else 'POSTS'
    if not module_is_available(item.site_id,module): return None
    if kind == 'news': return '/posts'
    model,identifier = (Page,item.page_id) if kind == 'page' else (Category,item.category_id) if kind == 'category' else (Post,item.post_id)
    obj = model.objects.filter(pk=identifier,site_id=item.site_id,status=ContentStatus.PUBLISHED).first()
    if not obj or (obj.published_at and obj.published_at > timezone.now()): return None
    if kind == 'category':
        return '/posts/categories/'+obj.slug if obj.is_active and obj.published_at else None
    if kind == 'page' and obj.visibility not in {Visibility.PUBLIC,Visibility.UNLISTED}: return None
    publication = PublishedContentSnapshot.objects.filter(content_id=obj.pk).order_by('-version').first()
    payload = publication.payload if publication else {}
    if publication and publication.published_at > timezone.now(): return None
    return payload.get('path',obj.path) if kind == 'page' else '/posts/'+payload.get('slug',obj.slug)

def destination_state(item):
    return 'ready' if resolve_destination(item) else 'unavailable'


def menu_origin(site_id):
    from django.conf import settings
    from apps.sites.models import SiteDomain
    domain=SiteDomain.objects.filter(site_id=site_id,status='ACTIVE',is_primary=True).first()
    return f"{'http' if settings.DEBUG else 'https'}://{domain.hostname}" if domain else None
