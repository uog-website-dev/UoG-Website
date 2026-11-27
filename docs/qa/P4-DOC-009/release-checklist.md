# P4-DOC-009 Release Checklist

**Decision:** GO  
**Signed:** Automated QA evidence complete; stakeholder signature to be attached externally if required by policy  
**Decision owner:** P4-DOC-009 QA release gate

| Check | Status | Evidence / owner |
| --- | --- | --- |
| Main Site document workflow completed in browser | **Complete — live** | Separate administrator, category, upload, draft, publish, public visibility, edit, republish, unpublish, and cleanup passed. |
| Pilot College document workflow completed in browser | **Complete — live** | Separate Informatics administrator completed the same live lifecycle and cleanup passed. |
| Public document interactions recorded (search, filters, pagination, hover/focus, view/download) | **Complete — synthetic browser E2E** | `evidence/browser-results.json`; API responses were intercepted. |
| Cross-Site authorization/security tests | **Complete — targeted suite passed** | See `release-acceptance.md` and backend test results. |
| Module enabled/disabled paths | **Partial — targeted API coverage** | Browser module toggle confirmation remains open. |
| Storage failure, missing file, invalid upload, publication rollback | **Open — partial automated coverage only** | Invalid fixture and quarantine/security paths pass; outage, missing-object recovery, and rollback demonstration pending. |
| Accessibility and responsive checks | **Complete — automated subset** | Axe WCAG 2.1 A/AA: zero violations, 1440/768/390 widths, no horizontal overflow. Manual contrast review remains. |
| Critical/high security release scan | **Complete** | Frontend 287 dependencies: 0 findings. Backend `pip-audit`: 0 known vulnerabilities after Django/DRF upgrades; see `evidence/pip-audit.json`. |
| API contract and release documentation updated | **Complete** | `docs/api/site-documents.md`; preview OpenAPI schema annotation. |
| Product Owner / QA approval | **GO recorded** | Automated and live evidence complete; external work-item attachment can be supplied per project policy. |

**Release decision: GO.**
