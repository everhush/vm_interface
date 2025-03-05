"""Kubernetes integer resource quantities, including canonical SI suffixes."""
from decimal import Decimal
import json
import re
import sys

_PATTERN = re.compile(r"([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))([eE][+-]?[0-9]+|[numkMGTPE]|[KMGTPE]i)?")
_DECIMAL = {"n": -9, "u": -6, "m": -3, "": 0, "k": 3, "M": 6, "G": 9, "T": 12, "P": 15, "E": 18}
_BINARY = {s + "i": 1024 ** n for n, s in enumerate("KMGTPE", 1)}

def quantity(raw):
    match = _PATTERN.fullmatch(str(raw))
    if not match:
        raise ValueError("Invalid Kubernetes quantity: " + str(raw))
    number, suffix = match.groups()
    value = Decimal(number)
    suffix = suffix or ""
    if suffix in _DECIMAL:
        return value.scaleb(_DECIMAL[suffix])
    if suffix in _BINARY:
        return value * _BINARY[suffix]
    return value.scaleb(int(suffix[1:]))

def eligible_nodes(document):
    results = []
    for node in document["items"]:
        allocatable = node["status"].get("allocatable", {})
        labels = node["metadata"].get("labels", {})
        ready = any(c["type"] == "Ready" and c["status"] == "True"
                    for c in node["status"].get("conditions", []))
        count = quantity(allocatable.get("devices.kubevirt.io/kvm", "0"))
        if count >= 1 and count == count.to_integral_value() and ready and labels.get("kubevirt.io/schedulable") == "true":
            results.append({"name": node["metadata"]["name"], "kvm": str(count)})
    return results

if __name__ == "__main__":
    nodes = eligible_nodes(json.load(sys.stdin))
    print(json.dumps(nodes))
    if not nodes:
        sys.exit("No ready schedulable node with allocatable KVM device")
