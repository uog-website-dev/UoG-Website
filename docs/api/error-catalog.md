# API error catalog

Handled REST errors use this envelope and preserve the matching
`X-Request-ID` response header. Supply a UUID in that header for correlation;
invalid or absent IDs are replaced. Do not interpret message wording as a
machine code. `details` contains field errors or a detail message.

```json
{
  "error": {
    "code": "precondition_required",
    "message": "A current If-Match header is required.",
    "details": {"detail": "Supply the current detail response ETag in If-Match."}
  },
  "request_id": "1ea47c51-f2d7-402b-ad9a-4df619d03055"
}
```

| HTTP | Stable code | Meaning / client action |
| --- | --- | --- |
| 400 | validation_error | Invalid body/field/type/parent, read-only field, hierarchy/lifecycle rule failure, unsupported create idempotency key, or invalid/unknown/repeated list query parameters. Correct input; inspect details. |
| 401 | not_authenticated | Missing, invalid or expired bearer token; preserves WWW-Authenticate. Authenticate again. |
| 403 | permission_denied | Missing platform-admin role or disabled development write gate. No retry with the same privileges/configuration. |
| 404 | not_found | Unknown resource, pagination page, or a domain/module id under another Site. |
| 405 | method_not_allowed | Unsupported operation, including administration PUT/DELETE. |
| 406 | not_acceptable | Response format unsupported. Use application/json for Organizations. |
| 409 | conflict | Duplicate normalized code or hostname, duplicate Site/module pair, database integrity/serialization/deadlock conflict, or hierarchy response over 1,000 nodes. Reconcile state or navigate a smaller hierarchy/use the paginated list. No SQL details exposed. |
| 412 | precondition_failed | If-Match is stale or unsupported. Retrieve current detail and reconcile changes. |
| 415 | unsupported_media_type | Use application/json for Organization request bodies. |
| 428 | precondition_required | Supply the exact current detail ETag in If-Match on administration PATCH and lifecycle requests. |
| 429 | throttled | Existing DRF throttling failures if configured; no Organization-specific rate limiter is added. |
| 503 | service_unavailable | Organization audit persistence failed. The mutation was rolled back. Restore audit storage before retrying; SQL details are not exposed. |

The catalog describes handled DRF failures. Unexpected server exceptions and
Django URL-resolution errors use Django's existing handling. A 409 represents
a conflict, not a successful idempotent replay. Domain rule failures detected
before SQL return 400; residual database conflicts return 409. Successful
responses use normal resource/pagination bodies, without an error envelope.

[OpenAPI snapshot](openapi.yaml) · [Organization contract](organizations.md) · [Site contract](sites.md)
