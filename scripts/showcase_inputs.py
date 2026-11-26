"""Fail-closed offline validation of exact-media showcase inputs.

No VM, credentials, runner provisioning or product API calls.
A passing result verifies script input only, never guest compatibility.
"""
import hashlib
import json
import re
from pathlib import Path
from android_fixture import ANDROID_RESULT_MODE

def normalize(text):
    if not isinstance(text, str):
        raise ValueError("Screen marker must be a string")
    return re.sub(r"[^a-z0-9]", "", text.lower())

def validate_steps(items, profile, recording):
    if not isinstance(items, list) or not items or len(items) > 100:
        raise ValueError("Each scenario phase needs 1–100 steps")
    budget = 0
    actions = set()
    for step in items:
        if not isinstance(step, dict) or len(step) != 1:
            raise ValueError("Each step must specify exactly one action")
        kind, value = next(iter(step.items()))
        actions.add(kind)
        if kind == "wait":
            if not isinstance(value, dict) or set(value) != {"text", "seconds"} or not 1 <= len(normalize(value["text"])) <= 100 or type(value["seconds"]) is not int or not 1 <= value["seconds"] <= 900:
                raise ValueError("Invalid visible checkpoint")
            budget += value["seconds"]
        elif kind == "delay":
            if type(value) is not int or not 0 <= value <= 60:
                raise ValueError("Invalid delay")
            budget += value
        elif kind == "text":
            if not isinstance(value, str) or not 0 < len(value) <= 4096 or not all(32 <= ord(c) <= 126 for c in value):
                raise ValueError("Invalid keyboard text")
        elif kind == "keys":
            if not isinstance(value, list) or not 1 <= len(value) <= 8 or not all(type(k) is int and 0 <= k <= 0x1fffffff for k in value):
                raise ValueError("Invalid keyboard keys")
        elif kind == "click-label":
            if not isinstance(value,dict) or set(value)!={"text","seconds"} or not 1 <= len(normalize(value["text"])) <= 60 or type(value["seconds"]) is not int or not 1 <= value["seconds"] <= 60:
                raise ValueError("Invalid visible button target")
            budget += value["seconds"]
        elif kind == "click":
            if not isinstance(value, list) or len(value) != 2 or any(type(v) is not int for v in value) or not 0 <= value[0] < 1920 or not 0 <= value[1] < 1200:
                raise ValueError("Invalid pointer coordinates")
        elif kind == "human":
            if recording or not isinstance(value, str) or not 1 <= len(value) <= 160:
                raise ValueError("Human authorization checkpoints must be outside recording")
        elif kind == "system-boot":
            if recording or profile != "windows" or value is not True:
                raise ValueError("System boot only permitted in Windows setup")
        else:
            raise ValueError("Unsupported scenario action")
    if recording and budget > 65:
        raise ValueError("Recorded scenario wait/delay budget exceeds 65 seconds; reserve time for API input and final evidence")
    return actions

def load_scenario(path: Path, profile: str):
    if profile not in ("windows", "android") or not path.is_file() or path.stat().st_size > 256 * 1024:
        raise ValueError("Invalid scenario file or profile")
    def unique(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON member")
            result[key] = value
        return result
    scenario = json.loads(path.read_text(), object_pairs_hook=unique)
    if not isinstance(scenario, dict) or set(scenario) != {"setup", "softwareSetup", "application", "beforeMarker", "afterMarker", "resultName", "expectedResultSha256"}:
        raise ValueError("Invalid scenario fields")
    before, after = normalize(scenario["beforeMarker"]), normalize(scenario["afterMarker"])
    if not 1 <= len(before) <= 100 or not 1 <= len(after) <= 100 or before == after:
        raise ValueError("Distinct visible before/after checkpoints required")
    if scenario["resultName"] != "result.txt":
        raise ValueError("Expected fixture output result.txt")
    expected = hashlib.sha256(b"VM Interface Windows 7-Zip functional proof\n").hexdigest() if profile == "windows" else ANDROID_RESULT_MODE
    if scenario["expectedResultSha256"] != expected:
        raise ValueError("Unexpected fixture result digest")
    setup = validate_steps(scenario["setup"], profile, False)
    if not isinstance(scenario["softwareSetup"],list):
        raise ValueError("Invalid software preparation")
    if scenario["softwareSetup"]:
        validate_steps(scenario["softwareSetup"],profile,False)
    if profile=="android" and not scenario["softwareSetup"]:
        raise ValueError("Android needs post-upload authorized installation and directory selection")
    application = validate_steps(scenario["application"], profile, True)
    if profile == "windows" and ("system-boot" not in setup or not ("7zip" in after or "proof7z" in after)):
        raise ValueError("Windows requires installer-to-system boot and real 7-Zip checkpoint")
    if profile == "android" and ("apkcompletearm64v8a" not in after or not application.intersection({"keys", "click", "click-label", "text"})):
        raise ValueError("Android requires native ABI checkpoint and actual application input")
    return scenario
