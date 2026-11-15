"""Profiling is explicit opt-in and captures aggregates, never request/SQL values."""
import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4
import pytest
from django.http import HttpResponse, StreamingHttpResponse
from django.db import connection
from apps.core.middleware import PerformanceMiddleware, RequestIDMiddleware

@pytest.mark.django_db
def test_sql_spans_correlate_without_recording_secrets(rf,settings):
    settings.PERF_INSTRUMENTATION_ENABLED=True
    nav,parent=str(uuid4()),str(uuid4())
    request=rf.get('/private/secret-name?access_token=DO_NOT_LOG&status=PRIVATE_QUERY_VALUE&ordering=PRIVATE_ORDERING',HTTP_AUTHORIZATION='Bearer SECRET',HTTP_X_NAVIGATION_ID=nav,HTTP_X_PARENT_REQUEST_ID=parent)
    request.resolver_match=SimpleNamespace(route='api/v1/sites/<int:site>/pages/')
    def view(request):
        with connection.cursor() as cursor:
            cursor.execute('SELECT %s',['PRIVATE_SQL_PARAMETER']);cursor.fetchone()
            cursor.execute('SELECT 1');cursor.fetchone()
        return HttpResponse('SECRET_BODY')
    with patch('logging.Logger.info') as log:
        response=RequestIDMiddleware(PerformanceMiddleware(view))(request)
    record=json.loads(log.call_args.args[0])
    assert record['sql_count']==2 and record['sql_ms']>=0
    assert record['navigation_id']==nav and record['parent_request_id']==parent
    assert record['request_id']==response['X-Request-ID']
    assert response['X-SQL-Count']=='2' and response['X-Navigation-ID']==nav
    assert all(secret not in log.call_args.args[0] for secret in ['SECRET','PRIVATE_SQL_PARAMETER','secret-name','access_token','PRIVATE_QUERY_VALUE','PRIVATE_ORDERING'])
    assert 'app;dur=' in response['Server-Timing'] and 'db;dur=' in response['Server-Timing']


def test_disabled_has_no_extra_headers_or_logs(rf,settings):
    settings.PERF_INSTRUMENTATION_ENABLED=False
    with patch('logging.Logger.info') as log:
        result=PerformanceMiddleware(lambda _:HttpResponse('ok'))(rf.get('/'))
    assert 'Server-Timing' not in result and 'X-SQL-Count' not in result
    log.assert_not_called()


def test_untrusted_trace_headers_and_streaming_boundary(rf,settings):
    settings.PERF_INSTRUMENTATION_ENABLED=True
    request=rf.get('/',HTTP_X_NAVIGATION_ID='not-a-uuid',HTTP_X_PARENT_REQUEST_ID='secret')
    with patch('logging.Logger.info') as log:
        result=PerformanceMiddleware(lambda _:StreamingHttpResponse(['later']))(request)
    data=json.loads(log.call_args.args[0]);assert data['navigation_id'] is None and data['parent_request_id'] is None
    assert data['streaming_body_excluded'] is True and 'X-Navigation-ID' not in result
