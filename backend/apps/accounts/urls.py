"""URL configuration for the accounts app."""
from django.urls import path

from .views import AdminOverviewView, MeView

urlpatterns = [
    path("me/", MeView.as_view(), name="me"),
    path("admin/overview/", AdminOverviewView.as_view(), name="admin-overview"),
]
