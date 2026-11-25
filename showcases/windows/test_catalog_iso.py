import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('catalog_iso', Path(__file__).with_name('build-catalog-iso.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def fixture():
    # Synthetic metadata, not actual signature evidence.
    files = []
    for entry in m.PIN['files']:
        file = dict(entry)
        if 'embeddedSignerThumbprint' in file:
            file['embeddedSignatureStatus'] = 'Valid'
        files.append(file)
    return {'signatureVerificationPassed':True, 'isoSha256':m.PIN['iso']['sha256'],
            'isoBytes':m.PIN['iso']['bytes'], 'catalog':dict(m.PIN['catalog']),
            'files':files, 'packages':[dict(m.PIN['winfsp'],key='winfsp',signatureStatus='Valid')]}

class CatalogReportTests(unittest.TestCase):
    def test_exact_report(self):
        m.verify_report(fixture())

    def test_rejects_wrong_inputs(self):
        for change in ('source','catalog','digest','kernel','service','winfsp','duplicate','failed'):
            with self.subTest(change=change):
                report=copy.deepcopy(fixture())
                if change=='source': report['isoSha256']='0'*64
                elif change=='catalog': report['catalog']['sha256']='0'*64
                elif change=='digest': report['files'][0]['sha256']='0'*64
                elif change=='kernel':
                    next(x for x in report['files'] if x['name']=='viofs.sys')['catalogVerified']=False
                elif change=='service':
                    next(x for x in report['files'] if x['name']=='virtiofs.exe')['embeddedSignatureStatus']='NotSigned'
                elif change=='winfsp': report['packages'][0]['signerThumbprint']='0'*40
                elif change=='duplicate': report['files'].append(dict(report['files'][0]))
                else: report['signatureVerificationPassed']=False
                with self.assertRaises(ValueError):
                    m.verify_report(report)

if __name__=='__main__':
    unittest.main()
