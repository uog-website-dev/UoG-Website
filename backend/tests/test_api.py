"""API tests for the sample pages endpoints."""
import pytest

from apps.api.models import Page


@pytest.mark.django_db
def test_pages_list(client):
    Page.objects.create(title="One", slug="one", content="c1")
    Page.objects.create(title="Two", slug="two", content="c2", is_published=False)
    response = client.get("/api/pages/")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1  # only published pages are exposed
    assert body["results"][0]["slug"] == "one"


@pytest.mark.django_db
def test_pages_home_seeds_home_page(client):
    response = client.get("/api/pages/home/")
    assert response.status_code == 200
    assert response.json()["slug"] == "home"
    assert Page.objects.filter(slug="home").exists()
