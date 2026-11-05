"""Central module activation for many Sites: scope, eligibility, preview, apply.

Activation state is only ever SiteModule.is_enabled. A preview is a signed
summary of the plan; apply recomputes the plan under locks and refuses a
preview whose plan no longer matches. Platform permission is checked at both
the HTTP boundary and the reusable preview/apply service.
"""
import hashlib
import json
from dataclasses import dataclass, field

from django.core import signing
from django.core.exceptions import ValidationError
from django.db import DEFAULT_DB_ALIAS, connections, transaction
from django.db.models import Count, Q

from apps.audit.writer import record_event
from apps.audit.context import audit_context, current_audit_context
from apps.organizations.hierarchy_lock import hierarchy_write

from ..models import Module, ModuleDependency, Site, SiteModule, SiteModuleOperation, SiteModuleOperationChange
from .modules import disable_module_for_site, enable_module_for_site

PREVIEW_SALT = "sites.module-bulk"
PREVIEW_MAX_AGE_SECONDS = 15 * 60
MAX_SITES_PER_OPERATION = 1000
MAX_MODULES_PER_OPERATION = 20
HIGH_IMPACT_SITE_COUNT = 5

ENABLE = SiteModuleOperation.Action.ENABLE
DISABLE = SiteModuleOperation.Action.DISABLE
NOT_ASSIGNED = SiteModuleOperationChange.State.NOT_ASSIGNED
ENABLED = SiteModuleOperationChange.State.ENABLED
DISABLED = SiteModuleOperationChange.State.DISABLED

CHANGE = "CHANGE"
UNCHANGED = "UNCHANGED"
BLOCKED = "BLOCKED"

REASONS = {
    "module_planned": "The module is planned and not implemented.",
    "module_deprecated": "The module is deprecated and cannot be enabled.",
    "module_not_shipped": "This deployment does not include the module's implementation.",
    "module_platform_disabled": "The module is turned off platform-wide.",
    "configuration_required": "The module needs Site settings. Enable it from the Site's Modules page first.",
    "site_archived": "Archived Sites are frozen. Restore the Site before changing its modules.",
    "missing_dependency": "A required module is not enabled for this Site and is not part of this operation.",
    "required_by": "Another module enabled on this Site requires this module.",
    "configuration_invalid": "The retained Site settings do not satisfy the current module schema. Update them on the Site's Modules page first.",
}


class BulkOperationError(Exception):
    """A rejected request. ``status`` maps onto the API's HTTP status."""

    def __init__(self, reason, message, *, status=400, details=None):
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.status = status
        self.details = details or {}


def implementation_label(module, shipped):
    if module.status == Module.Status.PLANNED:
        return "PLANNED"
    if module.status == Module.Status.DEPRECATED:
        return "DEPRECATED"
    return "AVAILABLE" if module.is_enabled and shipped else "IMPLEMENTED_DISABLED"


def _shipped_codes(using):
    with connections[using].cursor() as cursor:
        cursor.execute("SELECT code FROM sites_module_implementation")
        return {row[0] for row in cursor.fetchall()}


def _dependency_edges(using):
    requires, required_by = {}, {}
    for module_id, requires_id in ModuleDependency.objects.using(using).values_list("module_id", "requires_id"):
        requires.setdefault(module_id, set()).add(requires_id)
        required_by.setdefault(requires_id, set()).add(module_id)
    return requires, required_by


@dataclass
class Registry:
    modules: dict
    by_code: dict
    shipped: set
    requires: dict
    required_by: dict

    @classmethod
    def load(cls, *, using=DEFAULT_DB_ALIAS, lock=False):
        queryset = Module.objects.using(using).order_by("pk")
        if lock:
            queryset = queryset.select_for_update()
        modules = {module.pk: module for module in queryset}
        requires, required_by = _dependency_edges(using)
        return cls(modules, {m.code: m for m in modules.values()}, _shipped_codes(using), requires, required_by)

    def usable(self, module):
        return module.status == Module.Status.IMPLEMENTED and module.is_enabled and module.code in self.shipped

    def available(self, module_id, state, seen=()):
        if module_id in seen or state(module_id) != ENABLED or not self.usable(self.modules[module_id]):
            return False
        return all(self.available(pk, state, (*seen, module_id)) for pk in self.requires.get(module_id, ()))

    def enable_blockers(self, module):
        if module.status == Module.Status.PLANNED:
            return ["module_planned"]
        if module.status == Module.Status.DEPRECATED:
            return ["module_deprecated"]
        if module.code not in self.shipped:
            return ["module_not_shipped"]
        if not module.is_enabled:
            return ["module_platform_disabled"]
        return []

    def codes(self, ids):
        return sorted(self.modules[pk].code for pk in ids)

    def apply_order(self, modules, action):
        """Requirements are enabled first; dependents are disabled first."""
        depth = {}

        def walk(pk, seen=()):
            if pk in depth:
                return depth[pk]
            if pk in seen:
                return 0
            depth[pk] = 1 + max((walk(dep, (*seen, pk)) for dep in self.requires.get(pk, ())), default=0)
            return depth[pk]

        ordered = sorted(modules, key=lambda module: (walk(module.pk), module.code))
        return ordered if action == ENABLE else list(reversed(ordered))


# Scope -----------------------------------------------------------------------

def normalize_scope(scope):
    """Return a canonical scope dict so equal scopes sign identically."""
    kind = scope.get("type")
    if kind == SiteModuleOperation.ScopeType.SITE:
        return {"type": kind, "site_ids": [int(scope["site_ids"][0])]}
    if kind == SiteModuleOperation.ScopeType.SELECTED:
        return {"type": kind, "site_ids": sorted({int(pk) for pk in scope["site_ids"]})}
    if kind == SiteModuleOperation.ScopeType.ALL:
        return {"type": kind}
    if kind == SiteModuleOperation.ScopeType.ORGANIZATION:
        return {"type": kind, "organization": int(scope["organization"]), "include_descendants": bool(scope.get("include_descendants", False))}
    if kind == SiteModuleOperation.ScopeType.FILTER:
        filters = {key: value for key, value in (scope.get("filters") or {}).items() if value not in (None, "", [])}
        return {"type": kind, "filters": dict(sorted(filters.items()))}
    raise BulkOperationError("invalid_scope", "Choose a supported scope.")


def organization_ids(organization, include_descendants, *, using=DEFAULT_DB_ALIAS):
    # Reached through the Site relation: Sites must not import the Organizations domain.
    unit = Site._meta.get_field("organization_unit").related_model
    if not unit.objects.using(using).filter(pk=organization).exists():
        raise BulkOperationError("unknown_organization", "The Organization does not exist.", details={"organization": organization})
    if not include_descendants:
        return [organization]
    connection = connections[using]
    table = connection.ops.quote_name(unit._meta.db_table)
    parent = connection.ops.quote_name(unit._meta.get_field("parent").column)
    with connection.cursor() as cursor:
        cursor.execute(
            f"WITH RECURSIVE subtree AS (SELECT id FROM {table} WHERE id = %s"
            f" UNION ALL SELECT c.id FROM {table} c JOIN subtree p ON c.{parent} = p.id)"
            " SELECT id FROM subtree",
            [organization],
        )
        return [row[0] for row in cursor.fetchall()]


def filter_sites(queryset, filters, *, using=DEFAULT_DB_ALIAS):
    """Shared by the Site module list and the "all matching" scope."""
    if filters.get("search"):
        term = filters["search"]
        queryset = queryset.filter(Q(code__icontains=term) | Q(name__icontains=term))
    if filters.get("status"):
        queryset = queryset.filter(status=filters["status"])
    if filters.get("organization"):
        units = organization_ids(filters["organization"], filters.get("include_descendants", False), using=using)
        queryset = queryset.filter(organization_unit_id__in=units)
    if filters.get("site"):
        queryset = queryset.filter(pk=filters["site"])
    module_code, activation = filters.get("module"), filters.get("activation")
    if module_code and activation:
        rows = SiteModule.objects.using(using).filter(module__code=module_code)
        if activation == ENABLED:
            queryset = queryset.filter(pk__in=rows.filter(is_enabled=True).values("site_id"))
        elif activation == DISABLED:
            queryset = queryset.filter(pk__in=rows.filter(is_enabled=False).values("site_id"))
        else:
            queryset = queryset.exclude(pk__in=rows.values("site_id"))
    return queryset


def resolve_sites(scope, *, using=DEFAULT_DB_ALIAS, lock=False):
    queryset = Site.objects.using(using).select_related("organization_unit").order_by("pk")
    kind = scope["type"]
    if kind in {SiteModuleOperation.ScopeType.SITE, SiteModuleOperation.ScopeType.SELECTED}:
        queryset = queryset.filter(pk__in=scope["site_ids"])
    elif kind == SiteModuleOperation.ScopeType.ORGANIZATION:
        queryset = queryset.filter(organization_unit_id__in=organization_ids(scope["organization"], scope["include_descendants"], using=using))
    elif kind == SiteModuleOperation.ScopeType.FILTER:
        queryset = filter_sites(queryset, scope["filters"], using=using)
    if lock:
        queryset = queryset.select_for_update(of=("self",))
    sites = list(queryset[: MAX_SITES_PER_OPERATION + 1])
    if len(sites) > MAX_SITES_PER_OPERATION:
        raise BulkOperationError("scope_too_large", f"An operation can change at most {MAX_SITES_PER_OPERATION} Sites. Narrow the scope.")
    if kind in {SiteModuleOperation.ScopeType.SITE, SiteModuleOperation.ScopeType.SELECTED}:
        missing = sorted(set(scope["site_ids"]) - {site.pk for site in sites})
        if missing:
            raise BulkOperationError("unknown_sites", "One or more selected Sites do not exist.", details={"site_ids": missing})
    return sites


# Eligibility -------------------------------------------------------------------

@dataclass
class Plan:
    action: str
    modules: list
    sites: list
    items: list = field(default_factory=list)
    state_snapshot: dict = field(default_factory=dict)

    @property
    def changes(self):
        return [(item["site"], pair) for item in self.items for pair in item["pairs"] if pair["outcome"] == CHANGE]

    def summary(self):
        reasons = {}
        for item in self.items:
            for pair in item["pairs"]:
                for reason in pair["reasons"]:
                    reasons[reason["code"]] = reasons.get(reason["code"], 0) + 1
        outcomes = [{pair["outcome"] for pair in item["pairs"]} for item in self.items]
        changed_sites = sum(1 for seen in outcomes if CHANGE in seen)
        return {
            "matched_sites": len(self.items),
            "eligible_sites": changed_sites,
            "already_in_state_sites": sum(1 for seen in outcomes if seen == {UNCHANGED}),
            "blocked_sites": sum(1 for seen in outcomes if BLOCKED in seen),
            "expected_changes": len(self.changes),
            "unchanged_pairs": sum(1 for item in self.items for pair in item["pairs"] if pair["outcome"] == UNCHANGED),
            "blocked_pairs": sum(1 for item in self.items for pair in item["pairs"] if pair["outcome"] == BLOCKED),
            "blocked_reasons": [{"code": code, "count": count, "message": REASONS[code]} for code, count in sorted(reasons.items())],
        }

    def fingerprint(self):
        material = {
            "snapshot": self.state_snapshot,
            "action": self.action,
            "modules": [[m.code, m.status, m.is_enabled] for m in self.modules],
            "sites": [
                [item["site"].pk, item["site"].status, [
                    [pair["module"].code, pair["previous_state"], pair["outcome"], [r["code"] for r in pair["reasons"]]]
                    for pair in item["pairs"]
                ]] for item in self.items
            ],
        }
        return hashlib.sha256(json.dumps(material, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def _states(site_ids, *, using):
    return {
        (site_id, module_id): ENABLED if enabled else DISABLED
        for site_id, module_id, enabled in SiteModule.objects.using(using).filter(site_id__in=site_ids).values_list("site_id", "module_id", "is_enabled")
    }


def _needs_settings(module):
    properties = (module.configuration_schema or {}).get("properties") or []
    return any(isinstance(item, dict) and item.get("required") for item in properties)


def _reason(code, module=None):
    reason = {"code": code, "message": REASONS[code]}
    if module is not None:
        reason["module"] = module.code
    return reason


def evaluate(action, modules, sites, registry, *, using=DEFAULT_DB_ALIAS, assignments=None):
    plan = Plan(action, modules, sites)
    # Bind the preview to actual versions and dependency/configuration state,
    # not just the resulting CHANGE/BLOCKED labels. A rename, owner move,
    # settings edit or dependency change must not silently reuse approval.
    if assignments is None:
        assignments = list(SiteModule.objects.using(using).filter(site_id__in=[s.pk for s in sites]).order_by("pk").values(
            "id", "site_id", "module_id", "is_enabled", "configuration", "updated_at",
        ))
    states = {(row["site_id"], row["module_id"]): ENABLED if row["is_enabled"] else DISABLED for row in assignments}
    retained = {(row["site_id"], row["module_id"]): row["configuration"] for row in assignments}
    plan.state_snapshot = {
        "sites": [[s.pk, s.organization_unit_id, s.name, s.status, s.updated_at] for s in sites],
        "assignments": assignments,
        "registry": [[m.pk, m.code, m.status, m.is_enabled, m.configuration_schema, m.updated_at] for m in registry.modules.values()],
        "shipped": sorted(registry.shipped),
        "dependencies": [[pk, sorted(ids)] for pk, ids in sorted(registry.requires.items())],
    }
    target_ids = {module.pk for module in modules}
    for site in sites:
        state = lambda module_id: states.get((site.pk, module_id), NOT_ASSIGNED)  # noqa: E731
        pairs = {}
        for module in modules:
            previous = state(module.pk)
            wanted = ENABLED if action == ENABLE else DISABLED
            pair = {"module": module, "previous_state": previous, "new_state": wanted, "outcome": CHANGE, "reasons": []}
            if previous == wanted or (action == DISABLE and previous == NOT_ASSIGNED):
                pair.update(outcome=UNCHANGED, new_state=previous)
            else:
                codes = registry.enable_blockers(module) if action == ENABLE else []
                if action == ENABLE and previous == NOT_ASSIGNED and _needs_settings(module):
                    codes.append("configuration_required")
                elif action == ENABLE:
                    from ..module_schema import normalize_site_module_configuration
                    try:
                        normalize_site_module_configuration(module.configuration_schema, retained.get((site.pk, module.pk), {}))
                    except ValidationError:
                        codes.append("configuration_invalid")
                if site.status == Site.Status.ARCHIVED:
                    codes.append("site_archived")
                pair["reasons"] = [_reason(code) for code in codes]
            pairs[module.pk] = pair
        _apply_dependency_rules(action, pairs, target_ids, state, registry)
        for pair in pairs.values():
            if pair["reasons"]:
                pair.update(outcome=BLOCKED, new_state=pair["previous_state"])
        plan.items.append({"site": site, "pairs": [pairs[module.pk] for module in modules]})
    return plan


def _apply_dependency_rules(action, pairs, target_ids, state, registry):
    """Block until stable: a blocked requirement blocks the modules that need it."""
    changed = True
    while changed:
        changed = False
        for module_id, pair in pairs.items():
            if pair["outcome"] != CHANGE or pair["reasons"]:
                continue
            if action == ENABLE:
                for needed in sorted(registry.requires.get(module_id, ())):
                    needed_module = registry.modules[needed]
                    present = registry.available(needed, state)
                    planned = needed in pairs and pairs[needed]["outcome"] == CHANGE and not pairs[needed]["reasons"]
                    if not (present or planned):
                        pair["reasons"].append(_reason("missing_dependency", needed_module))
                        changed = True
            else:
                for dependent in sorted(registry.required_by.get(module_id, ())):
                    if state(dependent) != ENABLED:
                        continue
                    leaving = dependent in target_ids and pairs[dependent]["outcome"] == CHANGE and not pairs[dependent]["reasons"]
                    if not leaving:
                        pair["reasons"].append(_reason("required_by", registry.modules[dependent]))
                        changed = True


def dependency_blockers(site_id, module, action, *, using=DEFAULT_DB_ALIAS):
    """The same dependency rule for a single Site switch."""
    registry = Registry.load(using=using)
    states = _states([site_id], using=using)
    state = lambda module_id: states.get((site_id, module_id), NOT_ASSIGNED)  # noqa: E731
    wanted = ENABLED if action == ENABLE else DISABLED
    pairs = {module.pk: {"module": module, "previous_state": state(module.pk), "new_state": wanted, "outcome": CHANGE, "reasons": []}}
    _apply_dependency_rules(action, pairs, {module.pk}, state, registry)
    return pairs[module.pk]["reasons"]


def _target_modules(codes, registry):
    if not codes:
        raise BulkOperationError("modules_required", "Select at least one module.")
    unknown = sorted(set(codes) - set(registry.by_code))
    if unknown:
        raise BulkOperationError("module_not_found", "One or more modules do not exist.", details={"modules": unknown})
    return sorted((registry.by_code[code] for code in set(codes)), key=lambda module: module.code)


# Preview ---------------------------------------------------------------------

def is_high_impact(action, scope, summary):
    return (
        scope["type"] in {SiteModuleOperation.ScopeType.ALL, SiteModuleOperation.ScopeType.FILTER}
        or summary["eligible_sites"] >= HIGH_IMPACT_SITE_COUNT
        or (action == DISABLE and summary["eligible_sites"] > 1)
    )


def serialize_plan(plan, scope, registry):
    summary = plan.summary()
    warnings = []
    for module in plan.modules:
        needed = registry.codes(registry.requires.get(module.pk, ()))
        dependents = registry.codes(registry.required_by.get(module.pk, ()))
        if plan.action == ENABLE and needed:
            warnings.append({"module": module.code, "message": f"{module.code} requires {', '.join(needed)} on each Site."})
        if plan.action == DISABLE and dependents:
            warnings.append({"module": module.code, "message": f"{', '.join(dependents)} depend on {module.code}. Sites using them are blocked; nothing is disabled automatically."})
    return {
        "action": plan.action,
        "modules": [{"code": m.code, "name": m.name, "implementation_status": implementation_label(m, m.code in registry.shipped)} for m in plan.modules],
        "scope": scope,
        "summary": summary,
        "dependency_warnings": warnings,
        "high_impact": is_high_impact(plan.action, scope, summary),
        "confirmation_phrase": plan.action,
        "sites": [
            {
                "id": item["site"].pk, "code": item["site"].code, "name": item["site"].name,
                "status": item["site"].status,
                "organization": {"id": item["site"].organization_unit_id, "name": item["site"].organization_unit.name},
                "outcome": _site_outcome(item),
                "modules": [
                    {"code": pair["module"].code, "previous_state": pair["previous_state"], "new_state": pair["new_state"],
                     "outcome": pair["outcome"], "reasons": pair["reasons"]}
                    for pair in item["pairs"]
                ],
            } for item in plan.items
        ],
    }


def _site_outcome(item):
    seen = {pair["outcome"] for pair in item["pairs"]}
    if BLOCKED in seen:
        return "PARTIAL" if CHANGE in seen else BLOCKED
    return CHANGE if CHANGE in seen else UNCHANGED


def preview(user, *, action, module_codes, scope, using=DEFAULT_DB_ALIAS):
    _authorize(user)
    # Keep scope, graph and eligibility reads consistent with all mutations.
    with hierarchy_write(using=using):
        return _preview(user, action=action, module_codes=module_codes, scope=scope, using=using)


def _preview(user, *, action, module_codes, scope, using):
    scope = normalize_scope(scope)
    registry = Registry.load(using=using)
    modules = _target_modules(module_codes, registry)
    if len(modules) > MAX_MODULES_PER_OPERATION:
        raise BulkOperationError("too_many_modules", f"Select at most {MAX_MODULES_PER_OPERATION} modules.")
    sites = resolve_sites(scope, using=using)
    plan = evaluate(action, modules, sites, registry, using=using)
    body = serialize_plan(plan, scope, registry)
    body["preview_token"] = signing.dumps(
        {"v": 1, "u": str(user.pk), "a": action, "m": [m.code for m in modules], "s": scope, "f": plan.fingerprint()},
        salt=PREVIEW_SALT, compress=True,
    )
    body["expires_in"] = PREVIEW_MAX_AGE_SECONDS
    return body


# Apply -----------------------------------------------------------------------

def _authorize(user):
    from apps.authorization.services import permission_granted
    if not permission_granted(user, "platform.sites.manage_registry", audit=False):
        raise BulkOperationError("permission_denied", "Platform module management permission is required.", status=403)

def read_preview_token(user, token):
    try:
        payload = signing.loads(token, salt=PREVIEW_SALT, max_age=PREVIEW_MAX_AGE_SECONDS)
    except signing.SignatureExpired as exc:
        raise BulkOperationError("preview_expired", "The preview expired. Preview the change again.", status=409) from exc
    except signing.BadSignature as exc:
        raise BulkOperationError("invalid_preview", "The preview token is not valid.") from exc
    if not isinstance(payload, dict) or payload.get("v") != 1 or payload.get("u") != str(user.pk):
        raise BulkOperationError("invalid_preview", "The preview token is not valid.")
    return payload


def _request_fingerprint(token, reason):
    return hashlib.sha256(json.dumps([token, reason], separators=(",", ":")).encode()).hexdigest()


def _state_name(state):
    return {"ENABLED": "enabled", "DISABLED": "disabled", "NOT_ASSIGNED": "not_assigned"}[state]


def record_site_module_change(site_id, module, previous_state, new_state, *, operation=None, scope_type=SiteModuleOperation.ScopeType.SITE, reason="", using=DEFAULT_DB_ALIAS):
    """One audit event per Site module transition, shared by single and bulk paths."""
    record_event(
        action="SITE_MODULE_ENABLED" if new_state == ENABLED else "SITE_MODULE_DISABLED",
        entity_type="sites.sitemodule",
        entity_id=f"{site_id}:{module.code}",
        before={"site_id": site_id, "module": module.code, "state": _state_name(previous_state)},
        after={
            "site_id": site_id, "module": module.code, "state": _state_name(new_state),
            "operation_id": str(operation.pk) if operation else None, "scope": scope_type, "reason": reason,
        },
        changed_fields=["is_enabled"],
        using=using,
    )


def apply(user, *, token, idempotency_key, reason="", confirmation="", request_id=None, using=DEFAULT_DB_ALIAS):
    """Commit every expected change or none. Return ``(operation, replayed)``."""
    _authorize(user)
    actor = str(user.pk)
    reason = (reason or "").strip()
    request_fingerprint = _request_fingerprint(token, reason)
    context = current_audit_context()
    with audit_context(actor_kind="USER", actor_id=actor, request_id=request_id or context.request_id, ip=context.ip), hierarchy_write(using=using):
        _authorize(user)
        existing = SiteModuleOperation.objects.using(using).filter(actor_id=actor, idempotency_key=idempotency_key).first()
        if existing is not None:
            if existing.request_fingerprint != request_fingerprint:
                raise BulkOperationError("idempotency_key_reused", "This Idempotency-Key was used for a different request.", status=409)
            return existing, True
        # Completed requests remain replayable even after the preview expires.
        # A new operation always requires a currently valid, actor-bound token.
        payload = read_preview_token(user, token)
        registry = Registry.load(using=using, lock=True)
        modules = _target_modules(payload["m"], registry)
        sites = resolve_sites(payload["s"], using=using, lock=True)
        list(SiteModule.objects.using(using).select_for_update().filter(site_id__in=[site.pk for site in sites]).order_by("pk").values_list("pk", flat=True))
        plan = evaluate(payload["a"], modules, sites, registry, using=using)
        summary = plan.summary()
        if plan.fingerprint() != payload["f"]:
            raise BulkOperationError(
                "stale_preview", "Sites or modules changed after the preview. Review the new preview before applying.",
                status=409, details={"summary": summary},
            )
        if is_high_impact(payload["a"], payload["s"], summary):
            if not reason:
                raise BulkOperationError("reason_required", "Give a reason for a high-impact operation.")
            if confirmation != payload["a"]:
                raise BulkOperationError("confirmation_required", f"Type {payload['a']} to confirm this high-impact operation.")
        operation = SiteModuleOperation.objects.using(using).create(
            idempotency_key=idempotency_key, actor_id=actor, action=payload["a"],
            module_codes=[module.code for module in modules], scope_type=payload["s"]["type"], scope=payload["s"],
            reason=reason, request_id=request_id, request_fingerprint=request_fingerprint,
            matched_count=summary["matched_sites"], changed_site_count=summary["eligible_sites"],
            unchanged_count=summary["already_in_state_sites"], blocked_count=summary["blocked_sites"],
            change_count=summary["expected_changes"],
        )
        order = {module.pk: index for index, module in enumerate(registry.apply_order(modules, payload["a"]))}
        changes = sorted(plan.changes, key=lambda change: (change[0].pk, order[change[1]["module"].pk]))
        for site, pair in changes:
            module = pair["module"]
            if payload["a"] == ENABLE:
                enable_module_for_site(site.pk, module.pk, operation=operation, using=using)
            else:
                disable_module_for_site(site.pk, module.pk, operation=operation, using=using)
            SiteModuleOperationChange.objects.using(using).create(
                operation=operation, site=site, module=module,
                previous_state=pair["previous_state"], new_state=pair["new_state"],
            )
        record_event(
            action="SITE_MODULE_BULK_APPLIED", entity_type="sites.sitemoduleoperation", entity_id=operation.pk,
            after={
                "action": operation.action, "modules": operation.module_codes, "scope": operation.scope,
                "reason": reason, "matched_sites": operation.matched_count, "changed_sites": operation.changed_site_count,
                "changes": operation.change_count, "blocked_sites": operation.blocked_count,
            },
            using=using,
        )
    return operation, False


def record_rejection(user, *, reason_code, idempotency_key=None, details=None, using=DEFAULT_DB_ALIAS):
    """Rejected apply attempts are audited after the failed transaction rolls back."""
    with transaction.atomic(using=using):
        record_event(
            action="SITE_MODULE_BULK_REJECTED", entity_type="sites.sitemoduleoperation",
            entity_id=str(idempotency_key or "unidentified"),
            after={"reason": reason_code, "actor": str(getattr(user, "pk", "")), **(details or {})},
            using=using,
        )


# Read models -----------------------------------------------------------------

def activation_summary(*, using=DEFAULT_DB_ALIAS):
    registry = Registry.load(using=using)
    sites = list(Site.objects.using(using).select_related("organization_unit").order_by("pk"))
    total_sites = len(sites)
    assignments = list(SiteModule.objects.using(using).order_by("pk").values(
        "id", "site_id", "module_id", "is_enabled", "configuration", "updated_at",
    ))
    states = {(row["site_id"], row["module_id"]): ENABLED if row["is_enabled"] else DISABLED for row in assignments}
    counts = {
        row["module_id"]: row
        for row in SiteModule.objects.using(using).values("module_id").annotate(
            enabled=Count("pk", filter=Q(is_enabled=True)), disabled=Count("pk", filter=Q(is_enabled=False)),
        )
    }
    results = []
    for module in sorted(registry.modules.values(), key=lambda m: m.code):
        shipped = module.code in registry.shipped
        row = counts.get(module.pk, {})
        eligible = 0
        if registry.usable(module):
            plan = evaluate(ENABLE, [module], sites, registry, using=using, assignments=assignments)
            for item in plan.items:
                pair = item["pairs"][0]
                state = lambda pk: states.get((item["site"].pk, pk), NOT_ASSIGNED)
                if item["site"].status != Site.Status.ARCHIVED and (
                    pair["outcome"] == CHANGE or (pair["outcome"] == UNCHANGED and registry.available(module.pk, state))
                ):
                    eligible += 1
        results.append({
            "id": module.pk, "code": module.code, "name": module.name, "description": module.description,
            "status": module.status, "implementation_status": implementation_label(module, shipped),
            "is_shipped": shipped, "platform_enabled": module.is_enabled,
            "enabled_sites": row.get("enabled", 0), "disabled_sites": row.get("disabled", 0),
            "eligible_sites": eligible, "total_sites": total_sites,
            "requires": registry.codes(registry.requires.get(module.pk, ())),
            "required_by": registry.codes(registry.required_by.get(module.pk, ())),
            "updated_at": module.updated_at,
        })
    return results


def module_states_for_sites(site_ids, *, using=DEFAULT_DB_ALIAS):
    states = {}
    for site_id, code, enabled in SiteModule.objects.using(using).filter(site_id__in=site_ids).values_list("site_id", "module__code", "is_enabled"):
        states.setdefault(site_id, {})[code] = ENABLED if enabled else DISABLED
    return states
