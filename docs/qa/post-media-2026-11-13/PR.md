# Reuse Site media in Post articles

Authors can choose featured images and insert inline images through the Site Media Library in the full-page Post editor. Library upload remains available to permitted users. Alternative text is captured per placement, and saves retain asset IDs without copying objects.

Post saves and restore create media placement records inside the existing revision transaction. Backend validation rejects foreign, unavailable, processing and non-image assets. The existing media permission and module gates protect attachment. Publication revalidates dependencies, and public image delivery checks the resolved Site and current publication. Retained revisions protect their assets through the existing deletion policy.

Migration 0013 extends the current revision reference guard to Posts and inventories eligible historical featured references. It preserves publication snapshots and was applied, reversed and reapplied. The API schema and author guidance describe the image representation and retention behavior.

Validation includes 77 backend and revision tests, editor/picker and renderer component checks, a link/delete race, real MinIO/Celery upload processing, a role-separated publication flow and real Edge editing/public image delivery. Production builds and TypeScript pass. The exact results accompany this draft. [QA evidence](README.md)

Independent review and Azure DevOps Issue association remain pending.
