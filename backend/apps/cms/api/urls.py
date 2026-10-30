"""Site-scoped CMS role and workflow endpoints."""
from django.urls import path

from .workflow import (
    ContentRoleAssignmentDetailView,
    ContentRoleAssignmentsView,
    ContentWorkflowActionView,
)
from .revisions import (
    ContentRevisionDetailView,
    ContentRevisionListView,
    ContentRevisionRestoreView,
)

app_name = "cms"

urlpatterns = [
    path(
        "<int:site_pk>/content-roles/",
        ContentRoleAssignmentsView.as_view(),
        name="content-role-list",
    ),
    path(
        "<int:site_pk>/content-roles/<int:assignment_id>/",
        ContentRoleAssignmentDetailView.as_view(),
        name="content-role-detail",
    ),
    path(
        "<int:site_pk>/content/<uuid:content_id>/workflow/",
        ContentWorkflowActionView.as_view(),
        name="content-workflow",
    ),
    path(
        "<int:site_pk>/content/<uuid:content_id>/revisions/",
        ContentRevisionListView.as_view(),
        name="content-revision-list",
    ),
    path(
        "<int:site_pk>/content/<uuid:content_id>/revisions/<int:revision_number>/",
        ContentRevisionDetailView.as_view(),
        name="content-revision-detail",
    ),
    path(
        "<int:site_pk>/content/<uuid:content_id>/revisions/<int:revision_number>/restore/",
        ContentRevisionRestoreView.as_view(),
        name="content-revision-restore",
    ),
]
