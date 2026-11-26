"""Render and verify explicit disposable-device capacity settings."""
import argparse
import json
import os
import sys
from pathlib import Path

LARGE = {"windows", "android"}
PROFILES = {"core", "linux", *LARGE}
STAGE = "20Gi"
ENV = {
    "VM_MEDIA_MAX_MIB": "8192",
    "VM_MEDIA_STAGE_MAX_MIB": "16384",
    "VM_SYSTEM_MAX_GIB": "64",
    "VM_ACCOUNT_STORAGE_GIB": "128",
    "VM_ENABLE_GUEST_EXCHANGE_EVALUATION": "true",
}

def namespace(source, profile):
    if profile not in LARGE:
        return source
    documents = source.split("\n---\n")
    matches = [i for i, doc in enumerate(documents)
               if "\nkind: PersistentVolumeClaim\n" in doc
               and "\n  name: vm-media-stage\n" in doc]
    if len(matches) != 1:
        raise ValueError("Expected exactly one media stage PVC")
    i = matches[0]
    before = "requests: {storage: 512Mi}"
    if documents[i].count(before) != 1:
        raise ValueError("Unexpected base storage request")
    documents[i] = documents[i].replace(before, "requests: {storage: " + STAGE + "}")
    return "\n---\n".join(documents)

def environment(profile):
    if profile not in LARGE:
        raise ValueError("Large-media profile required")
    return {"api": {**ENV, **({"VM_ENABLE_ARM64_EVALUATION": "true"} if profile == "android" else {})},
            "reconcile": dict(ENV)}

def deployment(profile):
    return {"spec": {"template": {"spec": {"containers": [
        {"name": name, "env": [{"name": key, "value": value} for key, value in env.items()]}
        for name, env in environment(profile).items()]}}}}

def verify_deployment(value, profile):
    containers = {c["name"]: c for c in value["spec"]["template"]["spec"]["containers"]}
    for name, expected in environment(profile).items():
        env = containers[name]["env"]
        for key, value in expected.items():
            if [v for v in env if v["name"] == key] != [{"name": key, "value": value}]:
                raise ValueError("Missing or incorrect configuration: " + name + "/" + key)

def verify_pvc(value, profile):
    expected = STAGE if profile in LARGE else "512Mi"
    if value["metadata"]["name"] != "vm-media-stage" or value["spec"]["resources"]["requests"]["storage"] != expected:
        raise ValueError("Incorrect media staging reservation")

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("action", choices=["namespace", "deployment", "verify-deployment", "verify-pvc"])
    p.add_argument("profile", choices=sorted(PROFILES))
    args = p.parse_args()
    if args.profile in LARGE and os.environ.get("VM_DISPOSABLE_DEVICE") != "true":
        raise SystemExit("Large-media settings require an explicitly disposable device")
    if args.action == "namespace":
        print(namespace((Path(__file__).resolve().parents[1] / "infra/namespace.yaml").read_text(), args.profile), end="")
    elif args.action == "deployment":
        print(json.dumps(deployment(args.profile)))
    elif args.action == "verify-deployment":
        verify_deployment(json.load(sys.stdin), args.profile)
    else:
        verify_pvc(json.load(sys.stdin), args.profile)

if __name__ == "__main__":
    main()
