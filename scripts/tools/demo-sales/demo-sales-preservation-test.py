"""Pure offline restriction tests; no input file, Admin client or database calls."""
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('demo_cleaner',Path(__file__).with_name('07_clean_demo_sales_migration_snapshot_test.py'))
cleaner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleaner)
class DemoRestrictionTests(unittest.TestCase):
    def test_canonical_path_and_governed_roots_are_rejected(self):
        for data in [{'targetedBatchId':None},{'erfResolution':{}},{'erfLookup':{}},{'batchHistory':[]}]:
            for path in ['sales-all-meters/00123','demo_sales_meters/00123']:
                with self.subTest(path=path,data=data):
                    clean,_,errors=cleaner.clean_record({'documentId':'00123','documentPath':path,'data':data})
                    self.assertIsNone(clean)
                    self.assertTrue(any('CANONICAL_SALES_PROHIBITED' in e for e in errors))
if __name__=='__main__':unittest.main()
