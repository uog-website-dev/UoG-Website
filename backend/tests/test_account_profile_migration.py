"""Additive profile migration preserves existing identity links on rollback."""
import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
def test_profile_upgrade_and_rollback_preserve_legacy_identity():
    executor=MigrationExecutor(connection)
    current=executor.loader.graph.leaf_nodes()
    try:
        executor.migrate([("accounts","0001_initial")])
        apps=executor.loader.project_state([("accounts","0001_initial")]).apps
        user=apps.get_model("auth","User").objects.create(username="legacy-profile-migration",email="legacy@example.edu")
        identity=apps.get_model("accounts","OIDCIdentity").objects.create(user_id=user.pk,issuer="https://identity.example/realms/uog",subject="legacy-stable-subject")
        executor=MigrationExecutor(connection)
        executor.migrate([("accounts","0002_account_profile")])
        apps=executor.loader.project_state([("accounts","0002_account_profile")]).apps
        assert apps.get_model("accounts","OIDCIdentity").objects.get(pk=identity.pk).user_id==user.pk
        assert not apps.get_model("accounts","AccountProfile").objects.filter(user_id=user.pk).exists()
        apps.get_model("accounts","AccountProfile").objects.create(user_id=user.pk,state="ACTIVE",picture=b"")
        executor=MigrationExecutor(connection)
        executor.migrate([("accounts","0001_initial")])
        assert apps.get_model("auth","User").objects.get(pk=user.pk).username=="legacy-profile-migration"
        assert apps.get_model("accounts","OIDCIdentity").objects.get(pk=identity.pk).subject=="legacy-stable-subject"
    finally:
        MigrationExecutor(connection).migrate(current)
