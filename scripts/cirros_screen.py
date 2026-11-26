"""Strict interpretation of a known asynchronous CirrOS console message."""
import re

# Tesseract sometimes reads the opening bracket as l or i and splits the
# last word across lines. Only a complete timestamped known message qualifies.
_ENTROPY=re.compile(r"(?:(?:\[|l|i|£)\s*\d{1,6}\.\d{6}\]|f\s*\d{1,6}\.\d{6}1)\s*random:\s*nonblocking\s+pool\s+is\s+initial\s*i?\s*zed(?![a-z0-9])",re.I)
_MESSAGE=re.compile(r"\bnonblocking\s+pool\s+is\s+initial\s*i?\s*zed",re.I)

def normalize(text):
    return re.sub(r"[^a-z0-9]","",_ENTROPY.sub("",text).lower())

def ready(text,elapsed_seconds):
    return "cirroslogin" in normalize(text) and (bool(_MESSAGE.search(text)) or elapsed_seconds>=180)
