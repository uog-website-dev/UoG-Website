"""Post working copies reuse the CMS review and publication workflow."""
from uuid import uuid4
from django.core.exceptions import ValidationError
from django.shortcuts import get_object_or_404
from apps.organizations.hierarchy_lock import hierarchy_write
from apps.cms.models import ContentRole, ContentStatus, PublishedContentSnapshot
from apps.cms.authorization import require_cms_grant
from apps.cms.services.working_drafts import content_etag
from apps.cms.models import ContentEditConflict
from .services import require_posts_module
from .models import Post, Category, Tag


def open_post_draft(*, site_id, post_id, actor, if_match):
    with hierarchy_write():
        require_cms_grant(actor,site_id,(ContentRole.AUTHOR,))
        require_posts_module(site_id)
        live = get_object_or_404(Post.objects.select_for_update(),pk=post_id,site_id=site_id)
        if not if_match or if_match != content_etag(live):
            raise ContentEditConflict("The article changed. Reload its current revision.")
        if live.status != ContentStatus.PUBLISHED or live.draft_of_id:
            raise ValidationError({"status":"Open a working draft from an original published Post."})
        existing = live.working_drafts.exclude(status=ContentStatus.ARCHIVED).first()
        if existing is not None:
            return existing, False
        snapshot = PublishedContentSnapshot.objects.filter(content=live).order_by("-version").first()
        if snapshot is None:
            raise ValidationError({"status":"This Post has no publication snapshot."})
        payload = snapshot.payload
        draft = Post(
            site_id=site_id,locale=live.locale,draft_of=live,slug="wip-"+uuid4().hex[:20],
            created_by=actor,updated_by=actor,
            **{key:payload[key] for key in ("title","excerpt","content","excerpt_html","featured_media","seo","author_id","blocks","blocks_version","metadata")},
        )
        from .post_media import validate_post_images
        if "/assets/" in draft.featured_media and not draft.metadata.get("post_media", {}).get("featured_alt"):
            from apps.media.models import MediaAsset
            image = MediaAsset.objects.filter(site_id=site_id,pk=draft.featured_media.rsplit("/",1)[-1]).first()
            draft.metadata = {**draft.metadata,"post_media":{"featured_alt":(image.alt_text if image else "") or draft.title}}
        validate_post_images(draft,actor=actor)
        taxonomy = {}
        for field, model in (("categories",Category),("tags",Tag)):
            identifiers = {item["id"] for item in payload.get(field,[])}
            terms = list(model.objects.filter(pk__in=identifiers,site_id=site_id,is_active=True))
            if {str(term.pk) for term in terms} != identifiers:
                raise ValidationError({field:"Published taxonomy is unavailable. Restore its eligibility before revising."})
            taxonomy[field] = terms
        draft.save(taxonomy=taxonomy)
        return draft, True
