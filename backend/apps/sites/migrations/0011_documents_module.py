from django.db import migrations

def enable_documents(apps, schema_editor):
    Module = apps.get_model('sites', 'Module')
    Module.objects.update_or_create(code='DOCUMENTS', defaults={'name':'Documents','description':'Site document administration.','status':'PLANNED','is_enabled':False,'configuration_schema':{'schema_version':1,'properties':[]}})
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("INSERT INTO sites_module_implementation(code) VALUES ('DOCUMENTS') ON CONFLICT DO NOTHING")
    Module.objects.filter(code='DOCUMENTS').update(status='IMPLEMENTED',is_enabled=True)
    Dependency = apps.get_model('sites', 'ModuleDependency')
    documents = Module.objects.get(code='DOCUMENTS')
    media = Module.objects.get(code='MEDIA')
    Dependency.objects.get_or_create(module_id=documents.pk, requires_id=media.pk)

class Migration(migrations.Migration):
    dependencies = [('sites', '0016_footer_header_publication')]
    operations = [migrations.RunPython(enable_documents, migrations.RunPython.noop)]
