"""Mutable display metadata remains scoped, audited and separate from object identity."""
import pytest
from django.db import IntegrityError
from rest_framework.test import APIClient
from apps.audit.models import AuditEvent
from apps.media.models import MediaAsset
from apps.media.services import asset_write
from .test_media_assets import media_world, _asset
pytestmark = pytest.mark.django_db(transaction=True)


def client(w):
 c=APIClient(); c.force_authenticate(w.actor); return c


def test_name_categories_and_alt_can_be_saved_on_pending_upload_identity(media_world):
 w=media_world; row=_asset(w); original=(row.original_filename,row.storage_reference,row.checksum,row.site_id)
 root=f"/api/v1/sites/{w.a.pk}/assets/{row.pk}/"
 response=client(w).patch(root,{"display_name":"Campus open day","categories":[" Campus ","Events","campus"],"alt_text":"Students arriving at the hall"},format="json")
 assert response.status_code==200,response.content
 assert response.json()["display_name"]=="Campus open day"
 assert response.json()["categories"]==["Campus","Events"]
 assert response.json()["status"]=="PENDING"
 row.refresh_from_db()
 assert (row.original_filename,row.storage_reference,row.checksum,row.site_id)==original
 event=AuditEvent.objects.filter(entity_type="media.mediaasset",entity_id=str(row.pk)).latest("timestamp")
 assert event.actor_id==str(w.actor.pk) and event.after["site_id"]==w.a.pk
 assert event.after["categories"]==["Campus","Events"]
 assert client(w).get(f"/api/v1/sites/{w.a.pk}/assets/?search=open%20day").json()["results"][0]["id"]==str(row.pk)


def test_legacy_name_falls_back_and_protected_or_foreign_edits_are_atomic(media_world):
 w=media_world; row=_asset(w); api=client(w); root=f"/api/v1/sites/{w.a.pk}/assets/{row.pk}/"
 assert api.get(root).json()["display_name"]==row.original_filename
 assert api.patch(root,{"display_name":"Changed","site":w.b.pk},format="json").status_code==400
 assert api.patch(f"/api/v1/sites/{w.b.pk}/assets/{row.pk}/",{"display_name":"Foreign"},format="json").status_code==403
 row.refresh_from_db(); assert row.display_name=="" and row.categories==[]


@pytest.mark.parametrize("changes",[{"display_name":" "},{"display_name":"bad\nname"},{"categories":["x"]*11},{"categories":["x"*65]},{"categories":{"foreign":"value"}},{"categories":["bad\nlabel"]}])
def test_invalid_metadata_leaves_no_partial_changes(media_world,changes):
 w=media_world; row=_asset(w)
 response=client(w).patch(f"/api/v1/sites/{w.a.pk}/assets/{row.pk}/",{"alt_text":"Must roll back",**changes},format="json")
 assert response.status_code==400,response.content
 row.refresh_from_db(); assert row.alt_text=="" and row.categories==[] and row.display_name==""


def test_database_rejects_non_label_category_arrays(media_world):
 w=media_world; row=_asset(w)
 with pytest.raises(IntegrityError):
  with asset_write(w.actor,w.a.pk,"content.media.upload"):
   MediaAsset.objects.filter(pk=row.pk).update(categories=[{"name":"Invalid"}],updated_by=w.actor)
 row.refresh_from_db(); assert row.categories==[]
