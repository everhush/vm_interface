# Next.js compatibility

This branch evaluates the official Next.js App Router, preserving the primary API surface and Kubernetes architecture. The primary `main` is unchanged. Next.js 16.4.6, existing locked React and product dependency versions, and independent TypeScript loader tsx 4.23.15 are pinned. The Vite-family runtime, test runner, plugins, configuration and separate React Server Components bundler dependency are absent from the dependency lock. The native Node test runner preserves the prior 59 suites and 158-test evidence floor.

## Initial verification

[Next.js compatibility run 46102449515](https://github.com/everhush/vm_interface/actions/runs/46102449515), source `b017972d91d59564235cd5ac41815446c869caad`: success. The npm-resolved lock was retained and independently checked against [artifact 15246077471](https://github.com/everhush/vm_interface/actions/runs/46102449515/artifacts/15246077471). Lock SHA-256 `1e8b1d0dfca2998a5e7d233e280cca1619a1f765316f6334ee0ed73f2877ed70`; archive SHA-256 `5abaf2f2d32048c28912bd298bcbc60068f6293881f08cd70176d10f1b55ac2b`. 96 package entries; no removed framework-family dependency. TypeScript checking, 158/158 tests in 59 files with zero skipped/todo/fail, Next.js production build, source guard, worker loader probe and shell syntax checks passed. Actual production HTTP server: home page 200, all five API verbs return 401 and matching JSON without authorization, health fails closed without cluster/DB credentials.

The reviewed lock is committed on the next branch revision; bootstrap lock generation has been removed from the workflow. Subsequent builds use npm ci. Full native core CI is branch-targeted for this candidate; existing primary-branch native results are historical comparison evidence, not evidence of Next.js parity. No native Android or Windows qualification is asserted.

## Local checks

```sh
npm ci
npm run check
npm test
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

Use Node 24.11+ in the 24.x line and the documented evidence prerequisites. Use only authorized disposable KVM devices for full native integration.
