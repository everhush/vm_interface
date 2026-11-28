# Contributing

VM Interface is an API-first, evaluation-stage open-source project. Read the [README](readme.md), [architecture](docs/architecture.md), [API guide](docs/api.md) and [requirements ledger](docs/requirements.json) before proposing changes.

1. Branch from current `main`; make focused, reviewable changes and add regression tests.
2. Use Linux, Node.js 24.11+ (24.x), Bash, curl, FFmpeg/ffprobe with `libx264` and `drawtext`, Tesseract English language data, and DejaVu fonts. Run `bash scripts/device-validate.sh checks` (locked install, Vite+ format/typecheck/lint, tests and build). For interactive development use `npm run dev`, `npm run fmt`, `npm run check`, and `npm test`; these invoke the pinned local Vite+ CLI.
3. For virtualization changes reproduce the relevant native test on a fresh authorized disposable KVM host. Follow [device-validation.md](docs/device-validation.md); never run provisioning against a shared or production cluster. Never substitute mocks for claimed native guest success.
4. Open a pull request describing the behavior, risks, exact tested commit, checks and evidence. Keep authorization, scope, retry and resource cleanup assertions intact. Report unsupported profiles explicitly; do not include unlicensed guest images, credentials, raw guest recordings or sensitive logs.
5. Contributions must be authorized and compatible with [Apache-2.0](LICENSE); identify third-party material and preserve its terms/attribution. The project does not require copyright assignment.

See [repository maintenance](docs/repository-maintenance.md) before changing or pruning branches. Use the exact qualification SHA from the [migration record](docs/toolchain-migration.md) when reproducing evidence. Database changes require explicit compatibility and recovery testing; see [schema and upgrade boundaries](docs/database-schema.md).

Maintainer CI uses the public upstream `everhush/vm_interface`. Hosted workflows intentionally guard execution to that repository. Historical CI-only fork evidence applies only to the recorded commits. Do not weaken qualification gates to make a green badge. Contributors can run non-KVM checks locally. Independent device acceptance is tracked in #12, not a source-implementation task. Security reports follow [SECURITY.md](SECURITY.md).
