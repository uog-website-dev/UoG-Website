# Article review and publication

Open an article from Site Administration > Posts. The Publish panel shows its saved status, revision, latest reviewer comment and last publication date. Action controls come from the backend's available actions for the current Site role. Save your edits before changing review status or previewing the saved revision.

An Author submits a draft. A different Site Reviewer approves it or rejects it with a comment. Approval comments are optional under the existing policy. Rejection returns the article to draft and preserves its body. A Site Publisher publishes an approved revision or unpublishes a published article. Scheduling controls are absent because the backend has no verified scheduling contract.

Preview in the Post editor sticky bar opens a new tab using your authorized session. Unsaved changes are saved first. The preview is a full-viewport Site surface with header, footer and an article banner (title, excerpt and featured image when available). It requires an eligible Site role and enabled POSTS. The preview API returns private, no-store responses and the saved revision ETag. Anonymous requests receive a denied response.

For a published article, choose Edit working draft. The service opens or reuses its active private working copy. Visitors continue to receive the serving publication while the copy is edited and reviewed. The published article ID and permalink stay stable. Publishing the approved copy atomically updates the original article, creates its next publication snapshot and archives the working copy. Earlier snapshots and revisions remain recoverable under CMS retention. Unpublishing withdraws the original article from public delivery.

The working copy has its own ID, revision and temporary internal slug. The editor displays the original permalink and locks that field. `draft_of`, `publication_slug`, `publication_status` and `last_publication_at` are server-managed response fields. The original status appears in the working draft's Publish panel so editors can identify an article that was unpublished separately.

Transition failures retain the current form and show the backend error. Unsaved changes disable transition controls. Stale ETags return a conflict, and invalid transitions preserve the previous state. Saving a draft uses the existing optimistic concurrency handling and recovery controls. Rejected or restored drafts can be reopened for correction when an image has become unavailable. Submission and publication still require eligible media.

## API

Existing workflow and history routes continue to govern Posts.

```text
POST /api/v1/cms/sites/{site}/content/{post}/workflow/
GET /api/v1/cms/sites/{site}/content/{post}/workflow-history/
GET /api/v1/sites/{site}/posts/{post}/preview/
POST /api/v1/sites/{site}/posts/{post}/working-draft/
```

Preview returns the existing Post representation with its ETag. Opening a working draft requires the original published Post's `If-Match` header and returns HTTP 201 when created or HTTP 200 when reused. A missing ETag returns HTTP 428 and a stale ETag returns HTTP 409. The editor sends the current ETag with every workflow action. Legacy workflow callers retain the existing optional-header contract.

```json
{
  "action": "reject",
  "comment": "Please verify the research figures."
}
```

Cross-Site IDs are hidden under the authorized Site and denied under an unauthorized Site. Disabled POSTS rejects preview, working-copy and workflow administration. Current article presentation is compared with its reviewed and approved revisions before publication. The normal Post edit API rejects direct status or draft ownership changes.

## Configuration and migrations

Standard Reviewer and Publisher roles receive scoped `sites.view` and `content.media.view` capabilities so they can enter their assigned workspace and inspect article images. These grants provide read access. Post authoring and media upload retain their separate permissions, and workflow still requires the matching CMS Site role. Assign roles to the intended Site through the existing IAM administration.

Migration `api.0007_post_working_draft` adds the nullable self-reference and database guards for ownership, Site/language consistency, active-copy uniqueness and reviewed content locks. Existing Posts have a null link. Migration `api.0008_review_workspace_read_permissions` grants the workspace and media read capabilities to existing standard roles. Reversing 0008 retains those read grants. The schema rollback rehearsal runs on an isolated database containing an existing published article and checks its body and publication payload after reversing and reapplying the article link migration.

[OpenAPI](api/openapi.yaml) and [workflow QA](qa/post-workflow-2026-11-13/README.md)
