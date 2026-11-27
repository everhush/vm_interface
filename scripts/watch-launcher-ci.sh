#!/usr/bin/env bash
# Read-only CI infrastructure diagnostics, not a product-operation path.
set -u
mkdir -p evidence
while true; do
  {
    date -u +%FT%TZ
    kubectl -n vm-interface get vm,vmi,pods -o wide --request-timeout=10s
    kubectl -n vm-interface get pods -l kubevirt.io=virt-launcher -o json --request-timeout=10s |
      node -e 'const d=JSON.parse(require("node:fs").readFileSync(0,"utf8"));console.log(JSON.stringify(d.items.map(p=>({name:p.metadata.name,phase:p.status?.phase??null,init:p.status?.initContainerStatuses??[],containers:p.status?.containerStatuses??[]}))))'
  } >> evidence/launcher-timeline.txt 2>&1
  sleep 10
done
