"""Evidence gate: missing, failing or unreviewed inputs always produce No-Go."""
import argparse,hashlib,json,math,subprocess
from datetime import datetime,timezone
from pathlib import Path
CHECKS=('backend','frontend','e2e','security','accessibility','performance','operations','story_traceability','openapi','dependency_gates','build','typecheck')
REVIEWERS=('product_owner','qa','security','infrastructure')
def review_digest(m):
 payload={k:v for k,v in m.items() if k not in ['reviewed_manifest_sha256','signoffs']}
 return hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def evaluate(m,current_commit,required_stories=None):
 errors=[]
 def require(ok,message):
  if not ok:errors.append(message)
 require(m.get('schema_version')==1,'Unsupported evidence schema')
 require(m.get('candidate_commit')==current_commit,'Candidate commit differs from reviewed evidence')
 require(bool(m.get('release_issue')) and bool(m.get('evidence_attachment_reference')) and bool(m.get('release_review_pr')),'Release Issue/PR/evidence attachment references missing')
 for name in CHECKS:require(m.get('checks',{}).get(name)=='PASS',f'{name}: evidence missing, failed or unreviewed')
 stories=m.get('stories',[]);require(bool(stories),'Committed story inventory is missing')
 expected=set(required_stories if required_stories is not None else m.get('required_story_ids',[]))
 actual=[x.get('id') for x in stories]
 require(bool(expected) and set(actual)==expected and len(actual)==len(expected),'Committed story inventory is incomplete or duplicated')
 for story in stories:
  require(all(story.get(k) for k in ['id','pr','tests','qa_evidence']),f"{story.get('id','unknown')}: incomplete PR/test/QA traceability")
  review=story.get('review') or {}
  require(isinstance(review,dict) and review.get('status')=='APPROVED' and all(review.get(k) for k in ['reviewer','at','approval_reference']),f"{story.get('id','unknown')}: verified code-review record missing")
 accepted={r.get('defect_id'):r for r in m.get('accepted_risks',[]) if isinstance(r,dict)}
 for defect in m.get('defects',[]):
  require(defect.get('severity') in ['critical','high','medium','low','informational','unclassified'],f"{defect.get('id','unknown')}: invalid severity")
  require(not(defect.get('severity') in ['critical','high'] and defect.get('status')!='RESOLVED'),f"{defect.get('id','unknown')}: unresolved critical/high defect")
  if defect.get('status')!='RESOLVED' and defect.get('severity') not in ['critical','high']:
   risk=accepted.get(defect.get('id'),{})
   require(defect.get('severity')!='unclassified' and all(risk.get(k) for k in ['accepted_by','at','approval_reference','mitigation']),f"{defect.get('id','unknown')}: unresolved risk lacks explicit reviewed acceptance")
 p=m.get('performance',{});value=p.get('p95_load_ms')
 require(type(value) in (int,float) and math.isfinite(value) and 0<=value<1500,'p95 load under 1500 ms is not demonstrated')
 require(type(p.get('observed_concurrent_users')) is int and p['observed_concurrent_users']>=500,'500 concurrent users are not demonstrated')
 require(p.get('production_like') is True and bool(p.get('environment')) and bool(p.get('workload')) and bool(p.get('methodology_approval')),'Approved production-like environment/workload is missing')
 require(p.get('error_count')==0 and p.get('completed') is True,'Load test incomplete or contains errors')
 samples=p.get('raw_samples',[])
 valid=isinstance(samples,list) and len(samples)>=500 and all(type(x) in (int,float) and math.isfinite(x) and x>=0 for x in samples)
 require(valid,'At least 500 valid raw load samples are required')
 calculated=sorted(samples)[math.ceil(.95*len(samples))-1] if valid else None
 require(p.get('percentile_method')=='nearest_rank' and bool(p.get('measurement_definition')),'Load definition/percentile method missing')
 require(valid and type(value) in (int,float) and math.isfinite(value) and abs(calculated-value)<=.01,'Reported p95 does not match raw samples')
 require(m.get('accessibility',{}).get('manual_review')=='APPROVED','WCAG manual review/exception disposition is pending')
 for key in ['backup_restore','deployment_rollback','logs_monitoring']:
  item=m.get('operations',{}).get(key,{})
  require(item.get('reviewed') is True and bool(item.get('owner')) and bool(item.get('evidence')),f'{key}: responsible-team evidence/review missing')
 digest=m.get('reviewed_manifest_sha256')
 try:expected_digest=review_digest(m)
 except (ValueError,TypeError):expected_digest=None
 require(isinstance(digest,str) and digest==expected_digest,'Reviewed evidence manifest hash missing or changed')
 for role in REVIEWERS:
  approval=m.get('signoffs',{}).get(role,{})
  require(approval.get('decision')=='GO' and approval.get('name') not in [None,'','QA','PENDING','TODO','TBD'] and bool(approval.get('at')) and bool(approval.get('approval_reference')) and approval.get('manifest_sha256')==digest,f'{role}: named, evidence-bound approval missing')
 blocked=bool(errors)
 return {'schema_version':1,'decision':'NO_GO' if blocked else 'GO','production_ready':not blocked,'deployment_authorized':not blocked,'authority':'Evidence gate; approval records must be externally verified, never generated by automation','candidate_commit':current_commit,'blockers':errors,'product_owner_signoff':m.get('signoffs',{}).get('product_owner',{}).get('decision','PENDING')}
def verify_artifacts(m,root):
 errors=[];artifacts=m.get('artifacts',{})
 if not artifacts:return ['Evidence artifact hashes missing']
 for name,expected in artifacts.items():
  target=(root/name).resolve()
  if not target.is_relative_to(root.resolve()) or not target.is_file():errors.append(f'Invalid or missing artifact: {name}');continue
  if hashlib.sha256(target.read_bytes()).hexdigest()!=expected:errors.append(f'Artifact changed: {name}')
 return errors
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--manifest',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
 root=Path(__file__).resolve().parent.parent;m=json.loads(Path(args.manifest).read_text(encoding='utf-8-sig'))
 import re
 history=subprocess.check_output(['git','log','HEAD','--format=%s'],cwd=root,text=True)
 required=set(re.findall(r'P4-[A-Z]+-[0-9]{3}',history))
 if re.search(r'P4-POST-001.*(?:to|ot)[ -]*007',history):required.update(f'P4-POST-{i:03}' for i in range(1,8))
 commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip();result=evaluate(m,commit,required);errors=verify_artifacts(m,root)
 dirty=subprocess.run(['git','diff','--quiet','HEAD','--','backend','frontend'],cwd=root).returncode!=0
 untracked=subprocess.check_output(['git','ls-files','--others','--exclude-standard','--','backend','frontend'],cwd=root,text=True).strip()
 if dirty or untracked:errors.append('Application source differs from the committed release candidate')
 if errors:result.update(decision='NO_GO',production_ready=False,deployment_authorized=False);result['blockers'].extend(errors)
 result['generated_at_utc']=datetime.now(timezone.utc).isoformat()
 Path(args.output).write_text(json.dumps(result,indent=2),encoding='utf-8');print(result['decision']);raise SystemExit(0 if result['deployment_authorized'] else 1)
