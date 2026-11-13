"""Revision-bound visual approval and bounded private-storage availability checks."""
from django.core.exceptions import ValidationError
from django.http import Http404
from apps.cms.authorization import require_cms_grant
from apps.cms.models import ContentRole, ContentRevision, ContentWorkflowTransition, Page
from apps.cms.layout_contract import iter_nodes, validate_layout_media

PRESENTATION = ("title","blocks","blocks_version","metadata","seo","layout","visibility","locale",
                "parent_id","slug","path","position","is_homepage")


def presentation(payload):
    return {key:payload.get(key) for key in PRESENTATION}


def references(layout):
    for node,path in iter_nodes(layout):
        props=node.get("props",{})
        if node["type"] in {"image","hero_image"}:
            yield props["asset_id"],path+".props.asset_id"
        elif node["type"] in {"image_slider","image_grid"}:
            for i,item in enumerate(props["items"]):
                yield item["asset_id"],f"{path}.props.items[{i}].asset_id"


def approval_for(content, *, using):
    approval=ContentWorkflowTransition.objects.using(using).select_related("revision","reviewed_revision").filter(
        content_id=content.pk,to_status="APPROVED",revision__revision_number=content.revision_number).order_by("-id").first()
    if not isinstance(content,Page) or "visual_layout" not in content.metadata:
        return approval
    from .revisions import revision_snapshot
    if (approval is None or approval.reviewed_revision_id is None
            or presentation(approval.revision.snapshot) != presentation(revision_snapshot(content))
            or presentation(approval.reviewed_revision.snapshot) != presentation(approval.revision.snapshot)):
        raise ValidationError({"status":"The current visual revision has no matching approval. A new review is required."})
    return approval


def validate_publication(content, *, using):
    if not isinstance(content,Page) or "visual_layout" not in content.metadata:
        return
    from apps.sites.selectors.modules import module_is_available
    if not module_is_available(content.site_id,"PAGES",using=using):
        raise ValidationError({"module":"PAGES must be enabled before publishing."})
    layout=content.metadata["visual_layout"]
    if any(references(layout)) and not module_is_available(content.site_id,"MEDIA",using=using):
        raise ValidationError({"metadata.visual_layout":"MEDIA must be enabled before publishing referenced images."})
    validate_layout_media(layout,site_id=content.site_id)


def probe_publication(content_id, *, actor, using):
    """Do storage I/O before the global write lock. Its revision is rechecked.

    Existing draft references prevent deletion through the guarded lifecycle.
    Provider storage cannot participate in the DB transaction; an out-of-band
    object loss after this check still follows the scoped delivery fallback.
    """
    page=Page.objects.using(using).filter(pk=content_id).first()
    if page is None or page.status != "APPROVED" or "visual_layout" not in page.metadata:
        return None
    require_cms_grant(actor,page.site_id,(ContentRole.PUBLISHER,),using=using)
    approval_for(page,using=using)
    validate_publication(page,using=using)
    from apps.media import delivery
    from apps.media.models import MediaAsset
    from apps.media.processing import VARIANTS
    storage=delivery.ObjectStorage()
    checked=set()
    for asset_id,path in references(page.metadata["visual_layout"]):
        if asset_id in checked:continue
        asset=MediaAsset.objects.using(using).select_related("site","processing").get(pk=asset_id,site_id=page.site_id)
        try:
            # Reuse the delivery checksum/resource-limit/fallback policy. All
            # I/O and any original regeneration happen before the write lock.
            for variant in VARIANTS:
                delivery.image_response(asset,variant,storage=storage)
        except Http404 as error:
            raise ValidationError({path:"Image delivery is unavailable. Restore an approved derivative or its private original before publishing."}) from error
        checked.add(asset_id)
    return page.revision_number
