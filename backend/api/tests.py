"""
Tests for the API app
"""
from django.test import TestCase
from .models import Page


class PageTestCase(TestCase):
    def setUp(self):
        Page.objects.create(
            title='Test Page',
            slug='test-page',
            content='Test content'
        )

    def test_page_creation(self):
        page = Page.objects.get(slug='test-page')
        self.assertEqual(page.title, 'Test Page')
