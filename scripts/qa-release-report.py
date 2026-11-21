"""Consolidate captured QA facts without manufacturing approvals or green results."""
import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(path):
    raw = path.read_bytes()
    return raw.decode("utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig")


def junit(path):
    root = ET.fromstring(read(path))
    cases = list(root.iter("testcase"))
    failures = [{"class": t.get("classname"), "test": t.get("name")}
                for t in cases if t.find("failure") is not None or t.find("error") is not None]
    skipped = [{"class": t.get("classname"), "test": t.get("name"),
                "reason": t.find("skipped").get("message")}
               for t in cases if t.find("skipped") is not None]
    return {"tests": len(cases), "passed": len(cases)-len(failures)-len(skipped),
            "failed": len(failures), "skipped": len(skipped),
            "failures": failures, "skip_reasons": skipped}


def generate(out):
    def data(name):
        return json.loads(read(out / name))

    def write(name, value):
        (out / name).write_text(json.dumps(value, indent=2), encoding="utf-8")

    backend = junit(out / "backend.xml")
    focused = junit(out / "focused-frontend.xml")
    closure = junit(out / "skip-closure.xml")
    frontend = {}
    for package, numbers in re.findall(r"@uog/([^:]+):test:\s+Tests\s+([^\n]+)", read(out / "frontend.log")):
        frontend[package] = {name: int(re.search(r"(\d+) " + name, numbers).group(1))
                             if re.search(r"(\d+) " + name, numbers) else 0
                             for name in ("passed", "failed", "skipped")}
    assert frontend, "Missing frontend test totals"
    scans = data("accessibility.json")["rows"]
    a11y_failed = [r for r in scans if r["status"] != "AUTOMATED_PASS"]
    security = data("security-coverage.json")["groups"]
    security_pass = all(r["matched"] and not r["failed"] and not r["skipped"] for r in security.values())
    summary = {"backend": backend, "frontend": frontend,
               "frontend_totals": {k: sum(r[k] for r in frontend.values()) for k in ("passed", "failed", "skipped")},
               "focused_frontend_rerun": focused, "original_skip_closure": closure,
               "accessibility": {"scans": len(scans), "automated_pass": len(scans)-len(a11y_failed),
                                 "failed": len(a11y_failed), "manual_review": "PENDING"},
               "security_negative_groups_pass": security_pass}
    write("regression-summary.json", summary)
    defects = [
        {"id": "QA-REG-001", "severity": "medium", "status": "OPEN", "owner": "Platform/foundation maintainers",
         "finding": "Two backend foundation contract tests fail; see backend.xml/log.",
         "disposition": "Reconcile intended DEBUG-only localhost/Main behavior with foundation expectations; the other failure flags hostname text in a middleware comment. Do not relax unknown-host or production isolation guards."},
        {"id": "QA-REG-002", "severity": "medium", "status": "OPEN_TRIAGE", "owner": "Admin frontend/QA",
         "finding": "Full frontend suite failed media-picker-save selection feedback and visual-builder undo/redo timing. Both files pass focused rerun.",
         "disposition": "Retain initial failure. Investigate timing/test reliability and obtain a clean stable full-suite run; a focused pass does not waive full-suite failure."},
        {"id": "QA-A11Y-001", "severity": "medium", "status": "OPEN_TRIAGE", "owner": "Frontend/accessibility reviewers",
         "finding": "Automated color-contrast findings in Page/Post authoring; axe impact serious.",
         "disposition": "Review foreground/background and disabled-control exemption context, fix confirmed failures or record explicitly approved exceptions. No exception accepted yet."},
        {"id": "QA-A11Y-002", "severity": "medium", "status": "OPEN", "owner": "Frontend/accessibility reviewers",
         "finding": "Visible label text is missing from accessible names on authoring controls; axe label-content-name-mismatch, impact serious.",
         "disposition": "Use route/selector screenshots to fix accessible names and repeat desktop/mobile scans plus speech/keyboard review."},
    ]
    old_register = data("defects.json") if (out / "defects.json").exists() else {}
    old_defects = {d['id']: d for d in old_register.get('defects', [])}
    for item in defects:
        for key in ('severity', 'status', 'owner', 'disposition', 'resolution_evidence'):
            if key in old_defects.get(item['id'], {}):
                item[key] = old_defects[item['id']][key]
    defects.extend(d for key, d in old_defects.items() if key not in {x['id'] for x in defects})
    write("defects.json", {"severity_basis": "Proposed triage; axe impact is not organizational security severity. Human disposition pending.",
                           "defects": defects, "accepted_risks": old_register.get('accepted_risks', []),
                           "release_gaps": ["500-user production-like measurement", "Infrastructure recovery/rollback/log evidence",
                                            "Named PR and release approvals", "Story/Issue reconciliation", "Manual accessibility review",
                                            "Prior Sprint 1â€“3/PERF-010 gate reconciliation"]})
    stories = data("story-inventory.json")["stories"]
    environment = data("environment.json")
    build = data("build-results.json")
    openapi = data("openapi.json")
    manual = data("accessibility-manual-checklist.json")
    operations = data("operations.json")
    performance = data("performance.json")
    e2e = data("e2e-result.json")
    dependencies = data("dependency-gates.json")
    trace_complete = all(all(s.get(k) for k in ("pr", "tests", "qa_evidence"))
                         and isinstance(s.get("review"), dict)
                         and s["review"].get("status") == "APPROVED"
                         and all(s["review"].get(k) for k in ("reviewer", "at", "approval_reference"))
                         for s in stories)
    operations_complete = all(item.get("reviewed") is True and item.get("owner") and item.get("evidence")
                              for item in operations.values())
    checks = {"backend": "PASS" if not backend["failed"] else "FAIL",
              "frontend": "FAIL" if summary["frontend_totals"]["failed"] else "PASS",
              "e2e": e2e["status"],
              "security": "PASS" if security_pass else "FAIL",
              "accessibility": "FAIL" if a11y_failed else "PASS" if manual["status"] == "APPROVED" else "MANUAL_REVIEW_PENDING",
              "performance": "PASS" if performance["status"] == "PASS" else "BLOCKED",
              "operations": "PASS" if operations_complete else "PENDING",
              "story_traceability": "PASS" if trace_complete else "INCOMPLETE",
              "openapi": "PASS" if openapi["generation_exit"] == 0 and openapi["baseline_equal"] else "FAIL",
              "build": "PASS" if build["admin"] == 0 and build["public"] == 0 else "FAIL",
              "typecheck": "PASS" if data("typecheck-result.json")["exit_code"] == 0 else "FAIL",
              "dependency_gates": dependencies["status"]}
    # Preserve externally supplied approval records on regeneration. Changed
    # facts get a new digest, so stale approvals remain visible but cannot pass.
    previous = data("manifest.json") if (out / "manifest.json").exists() else {}
    approvals = previous.get("signoffs", {role: {"decision": "PENDING", "name": None,
        "at": None, "approval_reference": None, "manifest_sha256": None}
        for role in ("product_owner", "qa", "security", "infrastructure")})
    manifest = {"schema_version": 1, "candidate_commit": environment["candidate_commit"],
                "release_issue": previous.get("release_issue"), "release_review_pr": previous.get("release_review_pr"),
                "evidence_attachment_reference": previous.get("evidence_attachment_reference"),
                "checks": checks, "required_story_ids": [s["id"] for s in stories], "stories": stories,
                "defects": defects, "performance": performance,
                "accessibility": {"manual_review": manual["status"]}, "operations": operations,
                "signoffs": approvals, "accepted_risks": data("defects.json").get("accepted_risks", previous.get("accepted_risks", []))}
    sources = sorted([ROOT / "scripts/qa-release-report.py", *ROOT.joinpath("scripts").glob("qa-release-*.py"), ROOT / "scripts/qa-release-a11y.cjs", ROOT / ".github/workflows/regression.yml", ROOT / "azure-pipelines.yml"])
    write("source-hashes.json", {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set(sources))})
    excluded = {"manifest.json", "decision.json", "artifact-hashes.json"}
    artifacts = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in sorted(out.iterdir()) if p.is_file() and p.name not in excluded}
    # Bind the committed Main/college walkthroughs used as historical evidence.
    for relative in ("docs/qa/main-workflow-2026-11-21/README.md", "docs/qa/college-workflow-2026-11-21/README.md",
                     "docs/qa/college-workflow-2026-11-21/isolation.json", "docs/qa/P0-PERF-010/2026-11-20/README.md"):
        artifacts[relative] = hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
    for story in stories:
        relative = story.get("qa_evidence")
        if relative and (ROOT / relative).is_file():
            artifacts[relative] = hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
    manifest["artifacts"] = artifacts
    spec = importlib.util.spec_from_file_location("release_gate", ROOT / "scripts/qa-release-gate.py")
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    manifest["reviewed_manifest_sha256"] = gate.review_digest(manifest)
    write("manifest.json", manifest)
    print(json.dumps({"checks": checks, "backend": backend["passed"], "story_identifiers": len(stories)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="docs/qa/P4-QA-003/2026-11-21")
    args = parser.parse_args()
    generate((ROOT / args.output).resolve())
