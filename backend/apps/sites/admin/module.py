from django.contrib import admin

from ..models import Module, ModuleDependency, SiteModule
from ..selectors.modules import usable_modules


class ModuleDependencyInline(admin.TabularInline):
    model = ModuleDependency
    fk_name = "module"
    extra = 0
    autocomplete_fields = ("requires",)
    readonly_fields = ("created_at",)
    verbose_name = "required module"
    verbose_name_plural = "Required modules (enabling this module on a Site needs them enabled there first)"


@admin.register(Module)
class ModuleAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "status", "is_enabled")
    list_filter = ("status", "is_enabled")
    search_fields = ("code", "name", "description")
    readonly_fields = ("created_at", "updated_at")
    inlines = (ModuleDependencyInline,)

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields + (("code",) if obj is not None else ())

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(SiteModule)
class SiteModuleAdmin(admin.ModelAdmin):
    list_display = ("site", "module", "is_enabled", "updated_at")
    list_filter = ("is_enabled",)
    search_fields = ("site__code", "site__name", "module__code", "module__name")
    autocomplete_fields = ("site", "module")
    list_select_related = ("site", "module")
    readonly_fields = ("created_at", "updated_at")

    def get_readonly_fields(self, request, obj=None):
        if obj is not None:
            return self.readonly_fields + ("site", "module")
        return self.readonly_fields

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "module":
            allowed = set(usable_modules().values_list("pk", flat=True))
            object_id = getattr(request.resolver_match, "kwargs", {}).get("object_id")
            if object_id:
                current = SiteModule.objects.filter(pk=object_id).values_list("module_id", flat=True).first()
                if current:
                    allowed.add(current)
            kwargs["queryset"] = Module.objects.filter(pk__in=allowed)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        from ..services.modules import enable_module_for_site, disable_module_for_site
        from ..services.registry import registry_write
        with registry_write():
            if obj.is_enabled:
                saved = enable_module_for_site(obj.site_id, obj.module_id, configuration=obj.configuration)
            else:
                saved = disable_module_for_site(obj.site_id, obj.module_id)
                saved.configuration = obj.configuration
                saved.save(update_fields=["configuration"])
            obj.__dict__.update(saved.__dict__)
