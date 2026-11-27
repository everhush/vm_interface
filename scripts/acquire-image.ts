/** Client-side bounded HTTPS acquisition; no server-side arbitrary URL fetch. */
import { parseArgs } from "node:util";
import { acquire, MAX_BYTES } from "./acquire_image.ts";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sha256: { type: "string" },
    "allow-host": { type: "string", multiple: true },
    "max-bytes": { type: "string" },
    "expected-bytes": { type: "string" },
    "public-cache": { type: "string" },
    timeout: { type: "string" },
    authorized: { type: "boolean" },
  },
});
if (
  positionals.length !== 2 ||
  !values.sha256 ||
  !values["allow-host"]?.length ||
  !values.authorized
)
  throw Error("URL, output, sha256, allow-host and explicit authorization required");
console.log(
  JSON.stringify(
    await acquire(
      positionals[0],
      positionals[1],
      values.sha256,
      new Set(values["allow-host"]),
      values["max-bytes"] === undefined ? MAX_BYTES : Number(values["max-bytes"]),
      values["expected-bytes"] === undefined ? undefined : Number(values["expected-bytes"]),
      values["public-cache"],
      values.timeout === undefined ? 600 : Number(values.timeout),
    ),
  ),
);
