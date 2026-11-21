"""Evidence reconciliation must never erase an unmatched or newly failing test."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('collect-release-evidence.py').resolve()

class EvidenceTests(unittest.TestCase):
    def run_case(self, rerun, missing=False):
        with tempfile.TemporaryDirectory(prefix='uog-perf010-evidence-') as folder:
            root = Path(folder).resolve()
            self.assertEqual(root.parent, Path(tempfile.gettempdir()).resolve())
            def put(name, value):
                p=root/name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(value) if not isinstance(value,str) else value, encoding='utf-8')
            ok='<testsuite tests="1" failures="0" errors="0"><testcase classname="suite" name="fixed"/></testsuite>'
            put('full-backend.xml','<testsuite tests="1" failures="1" errors="0"><testcase classname="suite" name="fixed"><failure/></testcase></testsuite>')
            put('documentation.xml',rerun)
            for name in ['frontend.xml','minio.xml']:put(name,ok)
            for name in ['public-build','shared-frontend','service-health','openapi']:put(name+'.json',{'status':'PASS'})
            put('bundles.json',{'budget_violations':[]})
            for name in ['workspace','switch','sections','cache','dashboard','browser-reads','recovery','isolation']:
                if missing and name=='isolation':continue
                put('browser-final/'+name+'.json',{'status':'PASS'})
            put('api-load.json',{'failures':[],'dashboard_sites_reconciled':21,'samples':[{'kind':kind,'duration_ms':1} for kind in ['bootstrap','switcher','pages','posts','menus','media','dashboard'] for _ in range(60)]})
            put('final/production/results.json',{'metadata':{'source':{'commit':'abc'}}})
            result=subprocess.run([sys.executable,str(SCRIPT),str(root)],capture_output=True,text=True)
            return result.returncode,json.loads((root/'manifest.json').read_text())
    def test_exact_passing_rerun_is_recorded(self):
        code,data=self.run_case('<testsuite tests="1"><testcase classname="suite" name="fixed"/></testsuite>')
        self.assertEqual(code,0)
        self.assertEqual(data['resolved_failures'][0]['test'],'suite::fixed')
        self.assertIn('NOT_GRANTED',data['approval'])
    def test_unmatched_rerun_does_not_hide_failure(self):
        code,_=self.run_case('<testsuite tests="1"><testcase classname="suite" name="different"/></testsuite>')
        self.assertNotEqual(code,0)
    def test_new_rerun_failure_and_missing_security_artifact_fail(self):
        for rerun,missing in [('<testsuite tests="2"><testcase classname="suite" name="fixed"/><testcase classname="suite" name="new"><failure/></testcase></testsuite>',False),('<testsuite tests="1"><testcase classname="suite" name="fixed"/></testsuite>',True)]:
            code,_=self.run_case(rerun,missing)
            self.assertNotEqual(code,0)

if __name__=='__main__':unittest.main()
