"""Client-side bounded HTTPS acquisition; no server-side arbitrary URL fetch."""
import argparse
import json
from pathlib import Path
from acquire_image import acquire, MAX_BYTES

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("url")
p.add_argument("output", type=Path)
p.add_argument("--sha256", required=True)
p.add_argument("--allow-host", action="append", required=True)
p.add_argument("--max-bytes", type=int, default=MAX_BYTES)
p.add_argument("--expected-bytes", type=int)
p.add_argument("--public-cache", type=Path, help="Private client cache, only for authorized public images")
p.add_argument("--timeout", type=int, default=600)
p.add_argument("--authorized", action="store_true", required=True)
a = p.parse_args()
print(json.dumps(acquire(a.url, a.output, a.sha256, set(a.allow_host),
                         a.max_bytes, a.expected_bytes, a.public_cache, a.timeout),
                 sort_keys=True))
