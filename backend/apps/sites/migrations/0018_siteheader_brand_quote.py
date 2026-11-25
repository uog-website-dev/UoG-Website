from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sites", "0017_sitefooter_legal_links_siteheader_variant"),
    ]

    operations = [
        migrations.AddField(
            model_name="siteheader",
            name="brand_quote",
            field=models.CharField(blank=True, default="", max_length=280),
        ),
    ]
