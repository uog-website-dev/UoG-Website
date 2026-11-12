from contextlib import contextmanager

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from django.conf import settings
from django.http import Http404


class ObjectStorage:
    def client(self):
        return boto3.client(
            "s3", endpoint_url=settings.AWS_S3_ENDPOINT_URL,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.AWS_S3_REGION_NAME,
            use_ssl=settings.AWS_S3_USE_SSL,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=5, read_timeout=15, retries={"total_max_attempts": 1, "mode": "standard"}),
        )

    def put(self, bucket, key, stream, *, content_type):
        self.client().put_object(Bucket=bucket, Key=key, Body=stream, ContentType=content_type)

    def delete(self, bucket, key):
        self.client().delete_object(Bucket=bucket, Key=key)

    @contextmanager
    def open(self, bucket, key):
        try:
            stream = self.client().get_object(Bucket=bucket, Key=key)["Body"]
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in {"NoSuchKey", "404", "NoSuchBucket"}:
                raise Http404("Stored object not found.") from error
            raise
        try:
            yield stream
        finally:
            stream.close()
