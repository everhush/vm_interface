#!/usr/bin/env bash
# Read-only CI infrastructure diagnostics, not a product-operation path.
set -u
mkdir -p evidence
while true; do
  {
    date -u +%FT%TZ
    kubectl -n vm-interface get vm,vmi,pods -o wide --request-timeout=10s
    kubectl -n vm-interface get pods -l kubevirt.io=virt-launcher -o json --request-timeout=10s |
      python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps([{"name":p["metadata"]["name"],"phase":p.get("status",{}).get("phase"),"init":p.get("status",{}).get("initContainerStatuses",[]),"containers":p.get("status",{}).get("containerStatuses",[])} for p in d["items"]]))'
  } >> evidence/launcher-timeline.txt 2>&1
  sleep 10
done
