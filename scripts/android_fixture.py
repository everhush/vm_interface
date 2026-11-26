"""Native Android fixture output contract (client-side independent oracle)."""
import hashlib
ANDROID_RESULT_MODE="dynamic:sha256-of-challenge-result-v3"
def android_result(challenge):
    if not isinstance(challenge,bytes) or len(challenge)!=4096:
        raise ValueError("Expected exactly 4096 random challenge bytes")
    return b"VM Interface Android APK functional proof\nchallenge-sha256:"+hashlib.sha256(challenge).hexdigest().encode("ascii")+b"\n"
