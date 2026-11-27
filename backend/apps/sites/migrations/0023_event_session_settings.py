"""Session conflict publish-block and cancelled-session public visibility settings."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sites", "0022_events_module"),
    ]

    operations = [
        migrations.AddField(
            model_name="siteeventsettings",
            name="block_publish_on_session_room_conflicts",
            field=models.BooleanField(
                default=True,
                help_text="When true, Event publish is blocked while same-room session overlaps exist.",
            ),
        ),
        migrations.AddField(
            model_name="siteeventsettings",
            name="hide_cancelled_sessions_publicly",
            field=models.BooleanField(
                default=False,
                help_text="When true, cancelled sessions are omitted from the public agenda instead of labelled.",
            ),
        ),
    ]
