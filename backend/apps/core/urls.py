"""URLs for the platform core app (health endpoints)."""
from django.urls import path

from . import views

urlpatterns = [
    path("live", views.liveness, name="health-live"),
    path("ready", views.readiness, name="health-ready"),
]
