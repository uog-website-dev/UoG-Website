# Post authoring, review and public delivery

A Site author creates a draft Post with a category and a tag, then submits it.
A reviewer approves it, and a publisher publishes it. Pages and Posts share
`ContentWorkflowButtons` and `ContentWorkflowDialog`. The buttons come from
`available_actions`. That list follows the caller's Site CMS role, and an
author cannot approve their own Post. Reject requires a reviewer comment;
approve may include one. There is no schedule control, because the workflow
API accepts an action and a comment only. Every authoring URL is built from
that Site id. The workflow call is
`POST /api/v1/cms/sites/{site}/content/{post}/workflow/`. History is
`GET /api/v1/cms/sites/{site}/content/{post}/workflow-history/`.

The public site loads `GET /api/v1/site-context/posts/` and
`GET /api/v1/site-context/posts/{slug}/` with no Site id. The backend chooses
the Site from the trusted Host. Category and tag query values are slugs for
that Site. A draft, rejected, unpublished or foreign Post is not rendered.
Post HTML is shown as text plus links whose targets are same-site paths or
http(s) URLs. `javascript:` targets and `<script>` elements are not mounted.

When POSTS is off, create, edit and workflow changes are blocked. The public
routes return 404. Existing rows stay in the database. The site administration
screen does not mount the Post editor for a disabled module.

Standard roles that administer a Site include `content.posts.view`, and the
roles that edit or publish include the matching create, update or publish
codes. Those codes open the Posts section. The workflow itself still requires
the Site CMS role.

Evidence:

- `backend/apps/cms/tests/test_public_posts.py` — create, review, publish, taxonomy filters, draft invisibility, host isolation, XSS, disabled module
- `backend/apps/cms/tests/test_posts_api.py` — authoring contract, cross-site taxonomy, module gate
- `backend/apps/cms/tests/test_workflow_api.py` — role flow, snapshots, audit, module gate
- `frontend/apps/admin-web/src/sites/site-posts.test.tsx` — submit and publish, Site isolation, disabled module, unsafe preview
- `frontend/packages/ui/src/public-post.test.tsx` — published feed and detail, draft omission, keyboard link, XSS
