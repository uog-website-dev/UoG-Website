"""
Initialise the approved MinIO buckets (idempotent platform bootstrap).

Run once by the `minio-init` compose service after MinIO becomes healthy,
and safe to re-run at any time:

    python manage.py init_storage

Buckets (see infrastructure/minio/README.md):
    platform-public    — public read
    platform-private   — signed URLs only (default Django file storage)
    platform-documents — signed URLs only

There is deliberately no per-site bucket.
"""
import json

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

APPROVED_BUCKETS = ("platform-public", "platform-private", "platform-documents")
PUBLIC_READ_BUCKET = "platform-public"

PUBLIC_READ_POLICY = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": f"arn:aws:s3:::{PUBLIC_READ_BUCKET}/*",
        }
    ],
}


class Command(BaseCommand):
    help = "Create the approved platform buckets in MinIO (idempotent)."

    def _client(self):
        return boto3.client(
            "s3",
            endpoint_url=settings.AWS_S3_ENDPOINT_URL,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.AWS_S3_REGION_NAME,
            use_ssl=settings.AWS_S3_USE_SSL,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    def handle(self, *args, **options):
        client = self._client()
        try:
            existing = {b["Name"] for b in client.list_buckets().get("Buckets", [])}
            for bucket in APPROVED_BUCKETS:
                if bucket in existing:
                    self.stdout.write(f"exists    : {bucket}")
                    continue
                client.create_bucket(Bucket=bucket)
                self.stdout.write(self.style.SUCCESS(f"created   : {bucket}"))

            client.put_bucket_policy(
                Bucket=PUBLIC_READ_BUCKET, Policy=json.dumps(PUBLIC_READ_POLICY)
            )
            self.stdout.write(
                self.style.SUCCESS(f"policy set: {PUBLIC_READ_BUCKET} (public read)")
            )
        except (BotoCoreError, ClientError) as exc:
            raise CommandError(f"Object storage bootstrap failed: {exc}") from exc

        self.stdout.write(self.style.SUCCESS("Object storage is ready."))
