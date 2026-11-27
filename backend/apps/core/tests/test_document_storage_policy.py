import json

import pytest
from botocore.exceptions import ClientError
from django.core.management import call_command
from unittest.mock import Mock


@pytest.mark.django_db
def test_document_and_private_buckets_are_reset_to_private(monkeypatch):
    from apps.core.management.commands.init_storage import Command

    client = Mock()
    client.list_buckets.return_value = {"Buckets": [{"Name": name} for name in (
        "platform-public", "platform-private", "platform-documents",
    )]}
    client.delete_bucket_policy.side_effect = ClientError(
        {"Error": {"Code": "NoSuchBucketPolicy", "Message": "No policy"}}, "DeleteBucketPolicy",
    )
    monkeypatch.setattr(Command, "_client", lambda self: client)

    call_command("init_storage", stdout=Mock())

    assert client.put_bucket_policy.call_count == 1
    policy_call = client.put_bucket_policy.call_args.kwargs
    assert policy_call["Bucket"] == "platform-public"
    public_policy = json.loads(policy_call["Policy"])
    assert public_policy["Statement"][0]["Resource"] == "arn:aws:s3:::platform-public/*"
    assert client.put_bucket_acl.call_count == 2
    assert {call.kwargs["Bucket"] for call in client.put_bucket_acl.call_args_list} == {
        "platform-private", "platform-documents",
    }
    assert all(call.kwargs["ACL"] == "private" for call in client.put_bucket_acl.call_args_list)
    assert {call.kwargs["Bucket"] for call in client.delete_bucket_policy.call_args_list} == {
        "platform-private", "platform-documents",
    }
