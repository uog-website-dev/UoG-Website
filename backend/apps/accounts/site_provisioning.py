"""Server-only Keycloak creation with a fail-closed local provisioning saga."""
import base64
import io
import json
import urllib.error
import urllib.parse
import urllib.request
import warnings
from uuid import UUID

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from apps.authorization.catalog import SITE_MEMBERSHIP_ROLE_CODES
from apps.authorization.models import UserRoleAssignment
from apps.authorization.services import permission_granted, record_decision
from .models import AccountProfile, OIDCIdentity


class IdentityUnavailable(APIException):
    status_code = 503
    default_detail = "Account creation is temporarily unavailable. No Site access was granted. Please try again."


def normalize_picture(value):
    if not value:
        return b""
    try:
        raw = base64.b64decode(value, validate=True)
        if len(raw) > settings.ACCOUNT_PICTURE_MAX_BYTES:
            raise ValueError()
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format not in {"PNG", "JPEG", "WEBP"} or image.width * image.height > 4_000_000 or getattr(image,"n_frames",1) != 1:
                    raise ValueError()
                image.load()
                image = ImageOps.exif_transpose(image).convert("RGB")
                image = ImageOps.fit(image,(128,128))
                output = io.BytesIO()
                image.save(output,"JPEG",quality=85)
                return output.getvalue()
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValidationError({"profile_picture":"Choose a valid single-frame PNG, JPEG or WebP up to 2 MiB and 4 million pixels."}) from exc


class KeycloakAccounts:
    """Dedicated confidential service client; never uses realm admin passwords."""
    def __init__(self):
        self.base = settings.ACCOUNT_PROVISIONING_URL.rstrip("/")
        self.realm = settings.OIDC_ISSUER.rstrip("/").split("/")[-1]
        secret = settings.ACCOUNT_PROVISIONING_SECRET
        if not secret:
            raise IdentityUnavailable()
        form = urllib.parse.urlencode({"grant_type":"client_credentials","client_id":"site-user-provisioner","client_secret":secret}).encode()
        try:
            request = urllib.request.Request(f"{self.base}/realms/{self.realm}/protocol/openid-connect/token",data=form)
            with urllib.request.urlopen(request,timeout=10) as response:
                self.token = json.load(response)["access_token"]
        except Exception as exc:
            raise IdentityUnavailable() from exc

    def call(self,method,path,body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(f"{self.base}/admin/realms/{self.realm}/users{path}",data=data,method=method,
            headers={"Authorization":f"Bearer {self.token}","Content-Type":"application/json"})
        return urllib.request.urlopen(request,timeout=10)

    def create(self,username,email,password):
        try:
            with self.call("POST","",{"username":username,"email":email,"enabled":False,"emailVerified":False,
                    "credentials":[{"type":"password","value":password,"temporary":False}]}) as response:
                # Accept only the returned stable ID; never follow a supplied URL.
                return str(UUID(response.headers["Location"].rstrip("/").split("/")[-1]))
        except urllib.error.HTTPError as exc:
            if exc.code == 409:
                raise ValidationError({"username":"Username or email is already registered. Use Add existing user.","email":"Username or email is already registered."}) from exc
            if exc.code == 400:
                raise ValidationError({"password":"The identity provider rejected these account details. Check its password and account policy."}) from exc
            raise IdentityUnavailable() from exc
        except Exception as exc:
            raise IdentityUnavailable() from exc

    def enable(self,subject):
        with self.call("PUT",f"/{subject}",{"enabled":True}):
            pass

    def remove(self,subject):
        try:
            with self.call("DELETE",f"/{subject}"):
                pass
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                raise


def create_site_user(*,actor,site,role,username,email,password,profile_picture=b"",request=None):
    if not permission_granted(actor,"platform.users.assign_roles",organization_id=site.organization_unit_id,site_id=site.pk,request=request):
        raise PermissionDenied("You cannot create users for this Site.")
    if role.code not in SITE_MEMBERSHIP_ROLE_CODES or not role.is_active:
        raise ValidationError({"role":"Choose an active Site membership role."})
    client = None
    subject = None
    user = None
    try:
        client = KeycloakAccounts()
        subject = client.create(username,email,password)
        with transaction.atomic():
            # Recheck delegation immediately before writing local access.
            site = type(site).objects.select_for_update().get(pk=site.pk)
            if not permission_granted(actor,"platform.users.assign_roles",organization_id=site.organization_unit_id,site_id=site.pk,audit=False):
                raise PermissionDenied("Your Site assignment permission changed. No access was granted.")
            if site.status == "ARCHIVED" or site.organization_unit.status != "ACTIVE":
                raise ValidationError({"site":"Choose an eligible Site."})
            user = get_user_model()(username=username,email=email,is_active=False)
            user.set_unusable_password()
            user.save()
            OIDCIdentity.objects.create(user=user,issuer=settings.OIDC_ISSUER,subject=subject)
            AccountProfile.objects.create(user=user,picture=profile_picture)
            assignment = UserRoleAssignment.objects.create(user=user,role=role,scope="SITE",site=site,
                organization_id=site.organization_unit_id,assigned_by=actor)
        client.enable(subject)
        with transaction.atomic():
            profile=AccountProfile.objects.select_for_update().get(user=user)
            if profile.state != "PENDING":
                raise IdentityUnavailable()
            if not permission_granted(actor,"platform.users.assign_roles",organization_id=site.organization_unit_id,site_id=site.pk,audit=False):
                raise PermissionDenied("Your Site assignment permission changed. No access was granted.")
            role.refresh_from_db()
            site.refresh_from_db()
            if not role.is_active or role.code not in SITE_MEMBERSHIP_ROLE_CODES or site.status == "ARCHIVED":
                raise ValidationError({"role":"The Site or selected role is no longer eligible."})
            AccountProfile.objects.filter(user=user).update(state="ACTIVE")
            get_user_model().objects.filter(pk=user.pk).update(is_active=True)
            record_decision(user=actor,action="SITE_USER_CREATED",outcome="CHANGE",assignment=assignment,request=request)
            record_decision(user=actor,action="ROLE_ASSIGNED",outcome="CHANGE",assignment=assignment,request=request)
        return assignment
    except Exception as exc:
        # A retained tombstone blocks token provisioning even if remote cleanup
        # fails after an ambiguous enable response. Never delete a foreign ID.
        if user is not None and user.pk:
            with transaction.atomic():
                AccountProfile.objects.filter(user=user).update(state="FAILED",picture=b"")
                get_user_model().objects.filter(pk=user.pk).update(is_active=False)
                UserRoleAssignment.objects.filter(user=user,site=site,assigned_by=actor).delete()
        cleanup = True
        if subject:
            try:
                client.remove(subject)
            except Exception:
                cleanup = False
        if cleanup and user is not None and user.pk:
            get_user_model().objects.filter(pk=user.pk).delete()
        record_decision(user=actor,action="SITE_USER_CREATED",outcome="DENY",site_id=site.pk,
            organization_id=site.organization_unit_id,role_code=role.code,request=request,
            details={"provider_cleanup_complete":cleanup})
        if isinstance(exc,(ValidationError,PermissionDenied,IdentityUnavailable)):
            raise
        if isinstance(exc,IntegrityError):
            raise ValidationError({"username":"Username or email is already registered. Use Add existing user."}) from exc
        raise IdentityUnavailable() from exc
