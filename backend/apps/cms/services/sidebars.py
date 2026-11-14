"""Canonical Site-scoped sidebar validation, lifecycle and immutable projection."""
import re
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from apps.audit.writer import record_event
from apps.audit.context import audit_context
from apps.organizations.hierarchy_lock import hierarchy_write
from ..authorization import require_cms_grant
from ..models import ContentRole
from ..menu_models import Menu
from ..sidebar_models import Sidebar
from .pages import require_pages_module


def authorize(actor, site_id, *, edit=False):
    require_cms_grant(actor, site_id, (ContentRole.AUTHOR,) if edit else (ContentRole.AUTHOR, ContentRole.REVIEWER, ContentRole.PUBLISHER))
    require_pages_module(site_id)


def validate_components(value, site_id):
    from ..layout_contract import REGISTRY
    from ..models import Page
    approved = {entry['type'] for entry in REGISTRY}
    assert {'menu', 'loop_grid', 'recent_posts'} <= approved
    if not isinstance(value, list) or not 1 <= len(value) <= 12:
        raise ValidationError({'components': 'Provide between 1 and 12 ordered sidebar components.'})
    seen_ids, seen_menus, result = set(), set(), []
    for index, item in enumerate(value):
        path = f'components[{index}]'
        if not isinstance(item, dict):
            raise ValidationError({path: 'Use an approved sidebar component.'})
        kind = item.get('type')
        fields = {'menu': {'id','type','menu_id'}, 'related_pages': {'id','type','title','page_ids'}, 'recent_posts': {'id','type','title','limit'}}
        if kind not in fields or set(item) != fields[kind]:
            raise ValidationError({path: 'Use the local menu, related Pages or recent Posts schema.'})
        node_id = item['id']
        if not isinstance(node_id, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}', node_id) or node_id in seen_ids:
            raise ValidationError({path+'.id': 'Use a unique stable component ID.'})
        seen_ids.add(node_id)
        def identifier(raw, field):
            try: return str(UUID(str(raw)))
            except (ValueError, TypeError, AttributeError) as error:
                raise ValidationError({path+'.'+field: 'Choose a valid same-Site reference.'}) from error
        normalized = dict(item)
        if kind == 'menu':
            menu_id = identifier(item['menu_id'], 'menu_id')
            if menu_id in seen_menus:
                raise ValidationError({path+'.menu_id': 'A Menu can appear only once in a sidebar.'})
            if not Menu.objects.filter(pk=menu_id, site_id=site_id, is_active=True, is_global=False).exists():
                raise ValidationError({path+'.menu_id': 'Choose a same-Site active local Menu.'})
            seen_menus.add(menu_id); normalized['menu_id'] = menu_id
        else:
            if not isinstance(item['title'], str) or not item['title'].strip() or len(item['title']) > 120:
                raise ValidationError({path+'.title': 'Provide an accessible title of up to 120 characters.'})
            normalized['title'] = item['title'].strip()
            if kind == 'related_pages':
                raw_ids = item['page_ids']
                if not isinstance(raw_ids, list) or len(raw_ids) > 20:
                    raise ValidationError({path+'.page_ids': 'Choose up to 20 ordered Pages.'})
                ids = [identifier(raw, 'page_ids') for raw in raw_ids]
                if len(set(ids)) != len(ids) or Page.objects.filter(pk__in=ids, site_id=site_id, draft_of__isnull=True).count() != len(ids):
                    raise ValidationError({path+'.page_ids': 'Choose distinct Pages owned by this Site.'})
                normalized['page_ids'] = ids
            elif type(item['limit']) is not int or not 1 <= item['limit'] <= 10:
                raise ValidationError({path+'.limit': 'Choose between 1 and 10 recent Posts.'})
        result.append(normalized)
    return result


def project_component(item, *, site_id, locale):
    from apps.sites.selectors.modules import module_is_available
    from django.utils import timezone
    from ..models import PublishedContentSnapshot
    from ..selectors.pages import public_pages
    from ..selectors.posts import published_posts
    from ..selectors.menu_delivery import _project
    kind = item['type']
    module = {'menu':'MENUS', 'related_pages':'PAGES', 'recent_posts':'POSTS'}[kind]
    title = item.get('title', 'Navigation')
    if not module_is_available(site_id, module):
        return {**item, 'title': title, 'items': [], 'state': 'unavailable'}
    if kind == 'menu':
        menu = Menu.objects.filter(pk=item['menu_id'], site_id=site_id, is_active=True, is_global=False).first()
        if menu is None: return {**item, 'title':title, 'items':[], 'state':'unavailable'}
        items = _project(menu, 'local'); title = menu.name
    else:
        if kind == 'related_pages':
            rows = list(public_pages(site_id, locale).filter(pk__in=item['page_ids'], published_at__lte=timezone.now()).only('pk'))
            order = {pk: index for index, pk in enumerate(item['page_ids'])}
            rows.sort(key=lambda row: order[str(row.pk)])
        else:
            rows = list(published_posts(site_id, locale).only('pk')[:item['limit']])
        latest = {}
        snapshots = PublishedContentSnapshot.objects.filter(content_id__in=[row.pk for row in rows]).order_by('content_id','-version').distinct('content_id').values('content_id','published_at','payload__title','payload__path','payload__slug')
        for snapshot in snapshots:
            latest[snapshot['content_id']] = snapshot
        items = []
        for row in rows:
            snapshot = latest.get(row.pk)
            if snapshot is None or snapshot['published_at'] > timezone.now(): continue
            items.append({'label': snapshot['payload__title'], 'href': snapshot['payload__path'] if kind == 'related_pages' else '/posts/'+snapshot['payload__slug'], 'children': []})
    # Menu snapshots from P4-PAGE-002 remain byte-for-byte compatible.
    return {**item, 'title': title, 'items': items, **({'state':'ready' if items else 'empty'} if kind != 'menu' else {})}


def require_component_modules(components, site_id):
    from apps.sites.selectors.modules import module_is_available
    for component in components:
        required = {'menu':'MENUS', 'related_pages':'PAGES', 'recent_posts':'POSTS'}[component['type']]
        if not module_is_available(site_id, required):
            raise ValidationError({'components': required+' must be enabled to configure this component.'})


def freeze(sidebar, *, site_id, strict=False):
    from apps.sites.models import Site
    if sidebar.site_id != site_id or sidebar.status != 'ACTIVE':
        raise ValidationError({'sidebar': 'Choose an active sidebar owned by this Site.'})
    components = validate_components(sidebar.components, site_id) if strict else sidebar.components
    if strict: require_component_modules(components, site_id)
    locale = Site.objects.get(pk=site_id).default_language
    projected = [project_component(item, site_id=site_id, locale=locale) for item in components]
    count = 0
    def check_size(items):
        nonlocal count
        for item in items:
            count += 1
            if count > 2000:
                raise ValidationError({'components':'A sidebar may contain at most 2000 visible navigation items.'})
            check_size(item['children'])
    for item in projected:
        if item['type'] == 'menu': check_size(item['items'])
    capacity = count + sum(len(item['page_ids']) if item['type']=='related_pages' else item['limit'] if item['type']=='recent_posts' else 0 for item in components)
    if capacity > 2000:
        raise ValidationError({'components':'Sidebar configuration exceeds the 2000-item navigation capacity.'})
    return {'id':str(sidebar.pk), 'site':site_id, 'version':sidebar.version, 'name':sidebar.name, 'components':projected}


def delivery(snapshot, *, site_id, locale):
    from apps.sites.selectors.modules import module_is_available
    if not snapshot: return {}
    projected = []
    for component in snapshot.get('components', []):
        kind = component['type']
        if kind == 'menu':
            eligible = module_is_available(site_id, 'MENUS') and Menu.objects.filter(pk=component['menu_id'], site_id=site_id, is_active=True, is_global=False).exists()
            projected.append(component if eligible else {**component, 'items':[], 'state':'unavailable'})
        else:
            config = {key: value for key, value in component.items() if key not in {'items','state'}}
            public_component = project_component(config, site_id=site_id, locale=locale)
            public_component.pop('page_ids', None)  # Never disclose configured private Page identities.
            projected.append(public_component)
    if projected and all(c['type']=='menu' for c in projected) and any(c.get('state')=='unavailable' for c in projected): return {}
    return {**snapshot, 'components':projected}


def validate_page(page):
    if not page.sidebar_id:
        page.sidebar_snapshot = {}
        return
    if page.layout not in ('LEFT_SIDEBAR', 'RIGHT_SIDEBAR'):
        raise ValidationError({'sidebar': 'Choose Left Sidebar or Right Sidebar before assigning a sidebar.'})
    sidebar = Sidebar.objects.filter(pk=page.sidebar_id, site_id=page.site_id, status='ACTIVE').first()
    if sidebar is None:
        raise ValidationError({'sidebar': 'Choose an active sidebar owned by this Site.'})
    if not page.sidebar_snapshot or page.sidebar_snapshot.get('id') != str(sidebar.pk):
        page.sidebar_snapshot = freeze(sidebar, site_id=page.site_id, strict=True)


def validate_publication(page):
    if not page.sidebar_id:
        return
    current = freeze(page.sidebar, site_id=page.site_id, strict=True)
    def reviewed(value):
        return {**value, 'components': [
            component if component['type'] == 'menu' else {key: item for key, item in component.items() if key not in {'items','state'}}
            for component in value.get('components', [])
        ]}
    if reviewed(current) != reviewed(page.sidebar_snapshot):
        raise ValidationError({'sidebar': 'Sidebar or Menu content changed since review. Refresh the sidebar in the draft, save and submit for review again.'})


def write(*, site_id, actor, data, sidebar_id=None, expected=None):
    with hierarchy_write(), audit_context(actor_kind="USER", actor_id=str(getattr(actor, "pk", ""))):
        authorize(actor, site_id, edit=True)
        row = get_object_or_404(Sidebar.objects.select_for_update(), pk=sidebar_id, site_id=site_id) if sidebar_id else Sidebar(site_id=site_id, created_by=actor)
        if sidebar_id and expected != row.version:
            from ..models import ContentEditConflict
            raise ContentEditConflict('Sidebar changed. Reload it before saving.')
        for key, value in data.items():
            if key not in {'name', 'components', 'status'}:
                raise ValidationError({key: 'This field cannot be changed.'})
            if key == "components":
                value = validate_components(value, site_id)
            setattr(row, key, value)
        require_component_modules(row.components, site_id)
        row.updated_by = actor
        row.save()
        if row.status == "ACTIVE":
            freeze(row, site_id=site_id)
        record_event(action='SIDEBAR_UPDATED' if sidebar_id else 'SIDEBAR_CREATED', entity_type='cms.sidebar', entity_id=row.pk, after={'site_id': site_id, 'name': row.name, 'version': row.version, 'status': row.status}, changed_fields=list(data))
        return row


def remove(*, site_id, sidebar_id, actor, expected):
    with hierarchy_write(), audit_context(actor_kind="USER", actor_id=str(getattr(actor, "pk", ""))):
        authorize(actor, site_id, edit=True)
        row = get_object_or_404(Sidebar.objects.select_for_update(), pk=sidebar_id, site_id=site_id)
        if expected != row.version:
            from ..models import ContentEditConflict
            raise ContentEditConflict('Sidebar changed. Reload it before deleting.')
        if row.pages.exists():
            raise ValidationError({'sidebar': 'This sidebar is assigned to Pages. Remove those assignments and publish the replacements before deleting it.'})
        record_event(action='SIDEBAR_DELETED', entity_type='cms.sidebar', entity_id=row.pk, before={'site_id': site_id, 'name': row.name, 'version': row.version})
        try:
            row.delete()
        except ProtectedError as error:
            raise ValidationError({'sidebar': 'This sidebar is still assigned to a Page.'}) from error
