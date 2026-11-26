import io
import struct
import unittest
import zipfile
from apk_manifest_check import ANDROID_NS, NONE, manifest_metadata, verify_proof_apk_metadata

def fixture(utf8=False, package="org.vminterface.proof"):
    values=["manifest","package",package,ANDROID_NS,"versionName","3.0","versionCode"]
    pool=bytearray()
    offsets=[]
    for value in values:
        offsets.append(len(pool))
        pool.extend(bytes([len(value),len(value)])+value.encode()+b"\0" if utf8 else struct.pack("<H",len(value))+value.encode("utf-16-le")+b"\0\0")
    start=28+4*len(offsets)
    pool=struct.pack("<HHIIIIII",1,28,start+len(pool),len(offsets),0,0x100 if utf8 else 0,start,0)+struct.pack("<"+"I"*len(offsets),*offsets)+pool
    attrs=b"".join(struct.pack("<IIIHBBI",ns,name,NONE,8,0,kind,value) for ns,name,kind,value in [(NONE,1,3,2),(3,4,3,5),(3,6,16,3)])
    node=struct.pack("<HHIII",0x102,16,36+len(attrs),1,NONE)+struct.pack("<IIHHHHHH",NONE,0,20,20,3,0,0,0)+attrs
    return struct.pack("<HHI",3,8,8+len(pool)+len(node))+pool+node

def apk(data):
    result=io.BytesIO()
    with zipfile.ZipFile(result,"w") as z:z.writestr("AndroidManifest.xml",data)
    result.seek(0)
    return result

class ManifestMetadata(unittest.TestCase):
    def test_utf16_and_utf8_pool(self):
        for utf8 in (False,True):
            self.assertEqual(verify_proof_apk_metadata(apk(fixture(utf8))),{"package":"org.vminterface.proof","versionName":"3.0","versionCode":3})
    def test_reject_truncated_or_wrong_package(self):
        with self.assertRaises(ValueError):manifest_metadata(fixture()[:-1])
        with self.assertRaises(ValueError):verify_proof_apk_metadata(apk(fixture(package="wrong.package")))
