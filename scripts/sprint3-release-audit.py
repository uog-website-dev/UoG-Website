#!/usr/bin/env python3
"""Fail-closed Sprint review evidence. Checksums are not reviewer signatures."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]


def command(args):
    return subprocess.run(args,cwd=ROOT,text=True,capture_output=True)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_snapshot():
    names=command(["git","ls-files","--cached","--others","--exclude-standard","-z"]).stdout.split("\0")
    files={name:sha(ROOT/name) for name in sorted(set(names)) if name and (ROOT/name).is_file()
           and not name.startswith(("docs/qa/","frontend/docs/qa/"))}
    encoded=json.dumps(files,sort_keys=True).encode()
    return {"head":command(["git","rev-parse","HEAD"]).stdout.strip(),
            "dirty":bool(command(["git","status","--porcelain"]).stdout),
            "worktree_sha256":hashlib.sha256(encoded).hexdigest(),"files":files}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live",action="store_true",help="Seed isolated review Sites and ephemeral Keycloak role profiles")
    parser.add_argument("--build",action="store_true",help="Build both Next apps in temporary source copies")
    parser.add_argument("--output",default=f"docs/qa/sprint3-review-{datetime.now(timezone.utc):%Y-%m-%d}/release-audit")
    args=parser.parse_args()
    out=(ROOT/args.output).resolve();out.mkdir(parents=True,exist_ok=True)
    if ROOT not in out.parents:
        parser.error("Evidence must be written inside the repository")
    def write(name,value):
        path=out/name;path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(value if isinstance(value,str) else json.dumps(value,indent=2)+"\n",encoding="utf-8")
    source=source_snapshot();write("source.json",source)
    ps=command(["docker","compose","ps","--format","json"])
    services=[]
    for line in ps.stdout.splitlines():
        try:
            row=json.loads(line)
            services.append({key:row.get(key) for key in ("Service","Image","State","Health")})
        except ValueError:pass
    write("environment.json",{"utc":datetime.now(timezone.utc).isoformat(),"services":services,
        "execution":"existing development Compose services; pytest is a separate test DB",
        "secrets_recorded":False,"live_seed_requested":args.live})
    results=[]
    def run(name,cmd,artifact=None):
        print(f"Running {name}",flush=True)
        result=command(cmd);write(f"{name}.log",result.stdout+"\n"+result.stderr)
        row={"name":name,"command":cmd,"returncode":result.returncode,"status":"PASS" if result.returncode==0 else "FAIL"}
        if artifact:
            copied=command(["docker","compose","cp",artifact,str(out/artifact.split(":")[-1].split("/")[-1])])
            if copied.returncode:row["status"]="FAIL";row["artifact_copy_failed"]=True
        results.append(row)
        write("commands.json",results)
        return row
    if args.live:
        run("live-services",["docker","compose","run","--rm","-T","--no-deps","--entrypoint","python","-v",f"{ROOT}:/repo","backend",
            "/repo/scripts/sprint3_live_review.py","--output","/repo/"+str(out.relative_to(ROOT)).replace("\\","/")])
    run("protocol-and-negatives",["docker","compose","exec","-T","-e","RUN_MEDIA_MINIO_TESTS=1","backend","pytest",
        "tests/test_sprint3_integrated_review.py","tests/test_visual_publication.py","apps/cms/tests/test_homepage_assignment.py",
        "tests/test_visual_drafts.py","tests/test_media_removal.py","tests/test_media_uploads.py","apps/cms/tests/test_layout_contract.py",
        "apps/cms/tests/test_visual_builder_module.py","apps/cms/tests/test_widget_runtime.py","apps/cms/tests/test_public_posts.py","-q","--create-db","--tb=short","--junitxml=/tmp/sprint3-protocol.xml"],"backend:/tmp/sprint3-protocol.xml")
    run("openapi",["docker","compose","exec","-T","backend","python","manage.py","spectacular","--file","/tmp/sprint3-schema.yaml","--validate","--fail-on-warn"],"backend:/tmp/sprint3-schema.yaml")
    run("openapi-ci-regression",["docker","compose","exec","-T","backend","pytest","tests/test_documentation.py","-q","--tb=short","--junitxml=/tmp/sprint3-openapi.xml"],"backend:/tmp/sprint3-openapi.xml")
    run("contract-generator",[sys.executable,"scripts/generate_layout_contract.py","--check"])
    run("renderer-capability",["docker","compose","exec","-T","-e","SPRINT3_EVIDENCE_FILE=/tmp/sprint3-runtime.json","frontend-admin","pnpm","--filter","@uog/ui","exec","vitest","run","src/sprint3-runtime-evidence.test.tsx","src/widget-runtime.test.tsx","src/visual-layout.test.tsx","src/public-page.test.tsx","src/public-post.test.tsx","--reporter=junit","--outputFile=/tmp/sprint3-renderer.xml"],"frontend-admin:/tmp/sprint3-renderer.xml")
    copied=command(["docker","compose","cp","frontend-admin:/tmp/sprint3-runtime.json",str(out/"runtime-matrix.json")])
    if copied.returncode:results.append({"name":"runtime-matrix-copy","status":"FAIL"})
    run("typescript",["docker","compose","exec","-T","frontend-admin","pnpm","typecheck"])
    if args.build:
        for app in ("admin-web","public-web"):
            run(f"build-{app}",["docker","compose","exec","-T","frontend-admin","node","/workspace/scripts/qa/sprint3/build-isolated.mjs",app])
    live=json.loads((out/"live-services.json").read_text()) if (out/"live-services.json").exists() and args.live else None
    runtime=json.loads((out/"runtime-matrix.json").read_text()) if (out/"runtime-matrix.json").exists() else {}
    schema_match=(out/"sprint3-schema.yaml").exists() and sha(out/"sprint3-schema.yaml")==sha(ROOT/"docs/api/openapi.yaml")
    source_after=source_snapshot();stable=source["worktree_sha256"]==source_after["worktree_sha256"]
    write("source-after.json",source_after)
    defects=[
      {"id":"S3-E2E-002","severity":"release-gate","status":"NOT_VERIFIED","summary":"Real browser OAuth, picker/dashboard hydration and provider interactions have no end-to-end evidence",
       "evidence":"live-services.json records Next shell HTTP only; no waiver granted","blocks_acceptance":True},
      {"id":"S3-SIGNOFF-003","severity":"approval-gate","status":"PENDING","summary":"Named reviewer signatures and an actual hosted OpenAPI CI run are not supplied",
       "evidence":"signoff.json","blocks_acceptance":True}]
    if runtime.get("required_runtime_failures"):
        defects.append({"id":"S3-RUNTIME-001","severity":"release-blocker","status":"OPEN",
                        "summary":"Required widgets render the integration fallback",
                        "actual":runtime["required_runtime_failures"],"evidence":"runtime-matrix.json","blocks_acceptance":True})
    if any(row["status"]=="FAIL" for row in results):
        defects.append({"id":"S3-CHECK-004","severity":"release-blocker","status":"OPEN","summary":"One or more recorded commands failed","evidence":"commands.json","blocks_acceptance":True})
    if not schema_match:
        defects.append({"id":"S3-SCHEMA-005","severity":"release-blocker","status":"OPEN","summary":"Generated OpenAPI differs from the checked-in baseline or is missing","blocks_acceptance":True})
    if not stable:
        defects.append({"id":"S3-SOURCE-006","severity":"evidence-integrity","status":"OPEN","summary":"Source changed during the run; repeat against one frozen source snapshot","blocks_acceptance":True})
    xml=[]
    for file in sorted(out.glob("*.xml")):
        root=ET.parse(file).getroot();suites=[root] if root.tag=="testsuite" else list(root.iter("testsuite"))
        xml.append({"artifact":file.name,**{key:sum(int(s.get(key,0)) for s in suites) for key in ("tests","failures","errors","skipped")}})
    checks=[
       {"id":"S3-LIVE","expected":"Real role-scoped API upload/worker/publication/root, isolation, recovery","actual":live.get("status") if live else "NOT_RUN","status":live.get("status") if live else "NOT_RUN","evidence":"live-services.json"},
       {"id":"S3-CONTRACT","expected":"43 widget contracts and required runtime bindings","actual":runtime,"status":"FAIL" if runtime.get("required_runtime_failures") or len(runtime.get("widgets",[]))!=43 else "PASS","evidence":"runtime-matrix.json"},
       {"id":"S3-BROWSER","expected":"Real seeded-user browser walkthrough","status":"NOT_VERIFIED","defects":["S3-E2E-002"]},
       {"id":"S3-OPENAPI","expected":"Local CI-equivalent schema validation and baseline match","status":"PASS" if schema_match and next(r for r in results if r['name']=='openapi')['status']=='PASS' else "FAIL","evidence":"sprint3-schema.yaml; sprint3-openapi.xml"},
       {"id":"S3-SIGNOFF","expected":"Named stakeholder acceptance signatures","status":"UNSIGNED","defects":["S3-SIGNOFF-003"]}]
    write("checklist.json",checks);write("defects.json",defects)
    write("signoff.json",{"status":"UNSIGNED","QA Lead":None,"Technical Lead":None,"Product Owner":None,"hosted_ci_run":None,"waivers":[],"note":"Only actual reviewers may populate signatures; checksums do not constitute sign-off."})
    write("prototype-walkthrough/README.md","# Prototype only\n\nThe client-only Vite fixture and storage/auth doubles are excluded from live acceptance.\n")
    write("verification.json",{"technical_decision":"NO-GO","source_sha256":source["worktree_sha256"],"source_stable":stable,"tests":xml,"checks":checks,"defects":defects,"stakeholder_approval":"UNSIGNED","remote_ci":"NOT_SUPPLIED","schema_match":schema_match})
    report=["# Sprint 3 release audit", "", "**Decision: NO-GO for Sprint acceptance. Sign-off remains unsigned.**", "",
       f"Reviewed HEAD: `{source['head']}`; working tree dirty: `{source['dirty']}`.",f"Source snapshot: `{source['worktree_sha256']}`; stable throughout run: `{stable}`.","",
       "## Repeatable evidence", "", "| Run | Tests | Failures | Errors | Skips |", "| --- | ---: | ---: | ---: | ---: |"]
    for row in xml:report.append(f"| [{row['artifact']}]({row['artifact']}) | {row['tests']} | {row['failures']} | {row['errors']} | {row['skipped']} |")
    report.extend(["",f"Live services: **{live.get('status') if live else 'NOT RUN'}**. [Actual inputs/outcomes and retained Site/profile IDs](live-services.json).",
       "This uses real Keycloak JWTs, HTTP through nginx/Django, PostgreSQL, private MinIO and non-eager Celery workers. Next.js is probed as an HTTP shell; browser hydration is not asserted.",
       "", "## Acceptance blockers", ""])
    report.extend(f"- **{d['id']}**: {d['summary']}" for d in defects)
    report.extend(["", "Required runtime output failures: "+", ".join(runtime.get("required_runtime_failures",[]))+".",
       "A valid 43-widget schema is not proof of Contact Form visitor validation, taxonomy-filtered data, Site identity binding or Post-context switching. The actual shared renderer was probed without fake provider bindings.",
       "", "The pytest integration uses authentication/storage/processing doubles for deterministic protocol checks and is labelled separately from the real live run. Provider transfer-interruption tests are fault-injection tests, not proof that a live provider outage was exercised.",
       "", "No open release gate is automatically waived. Existing P2 defect dispositions require separate owner review; this run does not close or reclassify them.",
       "", "[Source/build environment](environment.json) · [commands](commands.json) · [runtime matrix](runtime-matrix.json) · [checklist](checklist.json) · [defects](defects.json) · [unsigned sign-off](signoff.json)",
       "", "Local OpenAPI checks follow the pipeline validation commands; an actual hosted CI run/link has not been supplied. [OpenAPI snapshot](sprint3-schema.yaml).",
       "", "The prototype walkthrough is [separate](prototype-walkthrough/README.md). Review-created identities are disabled; retained Sites, CMS revisions and audit rows belong to this review run and are not production homepage assignments."])
    write("report.md","\n".join(report)+"\n")
    write("manifest.json",{str(p.relative_to(out)).replace("\\","/"):sha(p) for p in sorted(out.rglob("*")) if p.is_file() and p.name!="manifest.json"})
    print(json.dumps({"decision":"NO-GO","report":str(out/"report.md"),"live_status":live.get("status") if live else None,"source_stable":stable,"tests":xml},indent=2))
    return 2


if __name__=="__main__":
    sys.exit(main())
