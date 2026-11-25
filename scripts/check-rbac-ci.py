"""Check exact RBAC attributes without discovery-dependent kubectl REST mapping."""
import json
import subprocess
from pathlib import Path

def check(group, resource, subresource, verb, allowed):
    attrs = {"namespace": "vm-interface", "group": group, "resource": resource,
             "verb": verb, "name": "vm-rbac-probe"}
    if subresource:
        attrs["subresource"] = subresource
    review = {"apiVersion": "authorization.k8s.io/v1", "kind": "SubjectAccessReview",
              "spec": {"user": "system:serviceaccount:vm-interface:vm-api",
                       "groups": ["system:serviceaccounts", "system:serviceaccounts:vm-interface",
                                  "system:authenticated"], "resourceAttributes": attrs}}
    result = subprocess.run(["kubectl", "create", "--raw",
                             "/apis/authorization.k8s.io/v1/subjectaccessreviews", "-f", "-"],
                            input=json.dumps(review), capture_output=True, text=True, check=True)
    status = json.loads(result.stdout)["status"]
    assert status.get("allowed", False) == allowed and not status.get("evaluationError"), (attrs, status)
    return {"attributes": attrs, "allowed": allowed}

def main():
    checks = [
        ("subresources.kubevirt.io", "virtualmachineinstances", "vnc", "get", True),
        ("subresources.kubevirt.io", "virtualmachineinstances", "vnc/screenshot", "get", True),
        ("subresources.kubevirt.io", "virtualmachineinstances", "console", "get", False),
        ("subresources.kubevirt.io", "virtualmachineinstances", "vnc", "update", False),
        ("subresources.kubevirt.io", "virtualmachineinstances", "reset", "update", True),
        ("subresources.kubevirt.io", "virtualmachineinstances", "reset", "get", False),
        ("subresources.kubevirt.io", "virtualmachineinstances", "portforward", "get", True),
        ("subresources.kubevirt.io", "virtualmachineinstances", "portforward", "update", False),
        ("", "secrets", "", "get", False),
        ("", "secrets", "", "create", False),
        ("export.kubevirt.io", "virtualmachineexports", "", "create", True),
        ("export.kubevirt.io", "virtualmachineexports", "", "patch", False),
        ("", "pods", "exec", "create", False),
        ("", "pods", "proxy", "get", False),
        ("", "pods", "", "create", True),
        ("", "pods", "", "delete", False),
        ("", "persistentvolumeclaims", "", "create", True),
        ("upload.cdi.kubevirt.io", "uploadtokenrequests", "", "create", True),
        ("cdi.kubevirt.io", "datavolumes", "", "create", True),
        ("cdi.kubevirt.io", "datavolumes", "", "delete", False),
        ("cdi.kubevirt.io", "datavolumes", "", "patch", False),
    ]
    evidence = [check(*item) for item in checks]
    # Direct infrastructure negative admission check, not product API proof.
    for kind, spec in [("Pod", {"containers":[{"name":"bad","image":"busybox","securityContext":{"privileged":True}}]}), ("PersistentVolumeClaim", {"accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"50Gi"}}})]:
        body={"apiVersion":"v1","kind":kind,"metadata":{"name":"forbidden-probe","namespace":"vm-interface"},"spec":spec}
        denied=subprocess.run(["kubectl","--as=system:serviceaccount:vm-interface:vm-api","create","--dry-run=server","-f","-"],input=json.dumps(body),capture_output=True,text=True)
        assert denied.returncode!=0 and "vm-exchange" in denied.stderr, (kind,denied.stderr)
        evidence.append({"kind":kind,"unsafeCreateDeniedByAdmission":True})
    dv={"apiVersion":"cdi.kubevirt.io/v1beta1","kind":"DataVolume","metadata":{"name":"forbidden-probe","namespace":"vm-interface"},"spec":{"source":{"blank":{}},"storage":{"storageClassName":"local-path","accessModes":["ReadWriteOnce"],"volumeMode":"Filesystem","resources":{"requests":{"storage":"1Gi"}}}}}
    denied=subprocess.run(["kubectl","--as=system:serviceaccount:vm-interface:vm-api","create","--dry-run=server","-f","-"],input=json.dumps(dv),capture_output=True,text=True)
    assert denied.returncode!=0 and "vm-data-disk" in denied.stderr,denied.stderr
    evidence.append({"kind":"DataVolume","unsafeCreateDeniedByAdmission":True})
    Path("evidence").mkdir(exist_ok=True)
    Path("evidence/rbac-checks.json").write_text(json.dumps(evidence, indent=2))
    print("Exact screenshot RBAC and forbidden access checks passed")

if __name__ == "__main__":
    main()
