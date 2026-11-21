import importlib.util,unittest,copy,tempfile,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('gate',Path(__file__).with_name('qa-release-gate.py'));gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
def complete():
 digest='b'*64
 result={'schema_version':1,'release_issue':'unit fixture','release_review_pr':'unit fixture','evidence_attachment_reference':'unit fixture','candidate_commit':'a'*40,'required_story_ids':['UNIT-001'],'checks':dict.fromkeys(gate.CHECKS,'PASS'),'stories':[{'id':'UNIT-001','pr':'unit fixture','review':{'status':'APPROVED','reviewer':'Unit fixture','at':'2026-11-21','approval_reference':'unit fixture, not a real approval'},'tests':'unit fixture','qa_evidence':'unit fixture'}],'performance':{'p95_load_ms':1499,'raw_samples':[1499.0]*500,'percentile_method':'nearest_rank','measurement_definition':'Unit fixture only','observed_concurrent_users':500,'production_like':True,'environment':'unit fixture','workload':'unit fixture','methodology_approval':'unit fixture','error_count':0,'completed':True},'accessibility':{'manual_review':'APPROVED'},'operations':{k:{'reviewed':True,'owner':'unit fixture','evidence':'unit fixture'} for k in ['backup_restore','deployment_rollback','logs_monitoring']},'reviewed_manifest_sha256':digest,'signoffs':{k:{'decision':'GO','name':'Unit fixture reviewer','at':'2026-11-21','approval_reference':'unit fixture, not a real approval','manifest_sha256':digest} for k in gate.REVIEWERS}}
 result['reviewed_manifest_sha256']=gate.review_digest(result)
 for item in result['signoffs'].values():item['manifest_sha256']=result['reviewed_manifest_sha256']
 return result
class GateTests(unittest.TestCase):
 def blocked(self,m):
  r=gate.evaluate(m,'a'*40);self.assertEqual(r['decision'],'NO_GO');self.assertFalse(r['production_ready']);self.assertFalse(r['deployment_authorized'])
 def test_missing_evidence_is_not_production_ready(self):self.blocked({})
 def test_complete_unit_fixture_can_pass(self):self.assertEqual(gate.evaluate(complete(),'a'*40)['decision'],'GO')
 def test_failed_regression_cannot_be_accepted_as_risk(self):
  m=complete();m['checks']['backend']='FAIL';self.blocked(m)
 def test_fewer_than_500_users_and_boundary_latency_fail(self):
  for field,value in [('observed_concurrent_users',499),('p95_load_ms',1500),('p95_load_ms',float('nan')),('p95_load_ms',float('inf')),('p95_load_ms',True)]:
   with self.subTest(field=field,value=value):m=complete();m['performance'][field]=value;self.blocked(m)
 def test_fast_summary_cannot_hide_slow_raw_samples(self):
  m=complete();m['performance']['raw_samples']=[3000.0]*500;self.blocked(m)
 def test_accepted_high_security_defect_still_blocks(self):
  m=complete();m['defects']=[{'id':'unit','severity':'high','status':'ACCEPTED_RISK'}];self.blocked(m)
 def test_open_medium_risk_needs_named_acceptance(self):
  m=complete();m['defects']=[{'id':'unit','severity':'medium','status':'OPEN'}];self.blocked(m)
 def test_unknown_severity_cannot_hide_a_high_defect(self):
  m=complete();m['defects']=[{'id':'unit','severity':'HIGH','status':'OPEN'}];self.blocked(m)
 def test_missing_infra_and_manual_wcag_reviews_block(self):
  m=complete();m['operations']['backup_restore']['reviewed']=False;self.blocked(m)
  m=complete();m['accessibility']['manual_review']='PENDING';self.blocked(m)
 def test_stale_commit_or_unbound_signoff_blocks(self):
  m=complete();m['candidate_commit']='c'*40;self.blocked(m)
  m=complete();m['signoffs']['product_owner']['manifest_sha256']='c'*64;self.blocked(m)
 def test_explicit_product_owner_no_go_and_omitted_story_block(self):
  m=complete();m['signoffs']['product_owner']['decision']='NO_GO';self.blocked(m)
  m=complete();m['required_story_ids'].append('UNIT-002');self.blocked(m)
 def test_generic_qa_label_is_not_a_signature(self):
  m=complete();m['signoffs']['qa']['name']='QA';self.blocked(m)
 def test_changed_missing_or_escaping_artifacts_fail(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'evidence').write_text('original');m={'artifacts':{'evidence':hashlib.sha256(b'original').hexdigest()}};self.assertEqual(gate.verify_artifacts(m,root),[])
   (root/'evidence').write_text('changed');self.assertTrue(gate.verify_artifacts(m,root));m['artifacts']={'../outside':'bad'};self.assertTrue(gate.verify_artifacts(m,root))
if __name__=='__main__':unittest.main()
