# Integrate article preview, review and publication

The Post editor now shows backend-confirmed status, reviewer comments, publication date and permitted workflow actions. Saved-revision preview opens in a session-authorized tab. Unsaved edits disable transitions, and failed actions retain the form and display the API error.

Published articles can open a private working copy. The existing review workflow approves that copy, and publication atomically promotes it onto the original article while preserving its public ID and permalink. Earlier snapshots remain retained. The service revalidates approval and media, serializes working-copy creation and invalidates the affected Site's public caches.

Migration 0007 adds the nullable Post link and database guards. Migration 0008 gives the standard Reviewer and Publisher roles scoped Site/media read access needed for workspace entry and preview. Post editing and media upload retain their existing permission checks.

Validation covers the clean-database API regression, schema reverse/reapply with an existing publication, component action/error states, real Author/Reviewer/Publisher browser handoff, two-Site isolation, disabled modules, private preview and public publication/unpublication. Build, schema and exact test results accompany the change. [QA evidence](README.md)

Independent approval and Azure DevOps Issue association remain pending.
