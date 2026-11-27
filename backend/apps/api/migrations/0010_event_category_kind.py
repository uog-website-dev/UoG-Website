from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0009_document_taxonomy"),
    ]

    operations = [
        migrations.AlterField(
            model_name="category",
            name="kind",
            field=models.CharField(
                choices=[("POSTS", "Posts"), ("DOCUMENTS", "Documents"), ("EVENTS", "Events")],
                default="POSTS",
                max_length=12,
            ),
        ),
    ]
