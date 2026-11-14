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
    if not isinstance(value, list) or not 1 <= len(value) <= 12:
        raise ValidationError({'components': 'Provide between 1 and 12 ordered Menu components.'})
    seen_ids, seen_menus, result = set(), set(), []
    for index, item in enumerate(value):
        path = f'components[{index}]'
        if not isinstance(item, dict) or set(item) != {'id', 'type', 'menu_id'} or item.get('type') != 'menu':
            raise ValidationError({path: 'Use a Menu component with id, type and menu_id.'})
        node_id = item['id']
        if not isinstance(node_id, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}', node_id) or node_id in seen_ids:
            raise ValidationError({path+'.id': 'Use a unique stable component ID.'})
        try:
            menu_id = str(UUID(str(item['menu_id'])))
        except (ValueError, TypeError, AttributeError) as error:
            raise ValidationError({path+'.menu_id': 'Choose a same-Site active Menu.'}) from error
        if menu_id in seen_menus:
            raise ValidationError({path+'.menu_id': 'A Menu can appear only once in a sidebar.'})
        if not Menu.objects.filter(pk=menu_id, site_id=site_id, is_active=True, is_global=False).exists():
            raise ValidationError({path+'.menu_id': 'Choose a same-Site active local Menu.'})
        seen_ids.add(node_id)
        seen_menus.add(menu_id)
        result.append({'id': node_id, 'type': 'menu', 'menu_id': menu_id})
    return result


def freeze(sidebar, *, site_id):
    from apps.sites.selectors.modules import module_is_available
    from ..selectors.menu_delivery import _project
    if sidebar.site_id != site_id or sidebar.status != 'ACTIVE':
        raise ValidationError({'sidebar': 'Choose an active sidebar owned by this Site.'})
    if not module_is_available(site_id, 'MENUS'):
        raise ValidationError({'sidebar': 'MENUS must be enabled to use a sidebar.'})
    components = validate_components(sidebar.components, site_id)
    projected = []
    count = 0
    def check_size(items):
        nonlocal count
        for item in items:
            count += 1
            if count > 2000:
                raise ValidationError({'components': 'A sidebar may contain at most 2000 visible navigation items.'})
            check_size(item['children'])
    for item in components:
        menu = Menu.objects.get(pk=item['menu_id'], site_id=site_id)
        items = _project(menu, 'local')
        check_size(items)
        projected.append({**item, 'title': menu.name, 'items': items})
    return {'id': str(sidebar.pk), 'site': site_id, 'version': sidebar.version,
            'name': sidebar.name, 'components': projected}


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
        page.sidebar_snapshot = freeze(sidebar, site_id=page.site_id)


def validate_publication(page):
    if not page.sidebar_id:
        return
    current = freeze(page.sidebar, site_id=page.site_id)
    if current != page.sidebar_snapshot:
        raise ValidationError({'sidebar': 'Sidebar or Menu content changed since review. Refresh the sidebar in the draft, save and submit for review again.'})


def write(*, site_id, actor, data, sidebar_id=None, expected=None):
    with hierarchy_write(), audit_context(actor_kind="USER", actor_id=str(getattr(actor, "pk", ""))):
        authorize(actor, site_id, edit=True)
        from ..menu_models import require_menus_module
        require_menus_module(site_id)
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
