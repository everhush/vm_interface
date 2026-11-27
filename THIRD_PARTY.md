# Third-party software and media

VM Interface's original source is licensed under Apache-2.0 (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). This does not relicense third-party code, packages, container images, operating systems, drivers, or guest data.

## Dependency and infrastructure inventory

- Node dependencies are pinned in [package-lock.json](package-lock.json). The [package manifest](package.json) intentionally remains private; no npm package is published. Lockfile metadata is an inventory aid, not a legal audit. The current lock includes MIT, Apache-2.0, LGPL-3.0-or-later, MPL-2.0, BSD, ISC and other license expressions. Preserve required notices, source/offer obligations and license texts when redistributing dependencies or container images. Resolve compound expressions and transitive packages from their upstream notices.
- K3s, KubeVirt/QEMU/KVM, CDI, CloudNativePG/PostgreSQL and host tools are separately distributed projects. See [pinned provisioning manifest](infra/provision-sources.json). Release asset hashes prove byte integrity, not blanket publisher authenticity or a complete supply-chain audit. Review each upstream license and provenance before redistribution.
- FFmpeg/ffprobe, Tesseract, skopeo, Android SDK/build tools and external tools retain their own terms. FFmpeg licensing depends on the build configuration.
- See [catalog](src/catalog.ts) and [media-sources.json](showcases/media-sources.json) for exact source references. Pinned CirrOS and Fedora KubeVirt images are test inputs with component licensing review required. The Android/LineageOS image is fetched only from its specified upstream with attestation and digest checks; review its component terms, including any bundled firmware or binaries. Optional Windows, VirtIO, WinFsp and 7-Zip media require their own authorized acquisition, license and signature checks.
- The repository distributes source fixtures, not guest installation media or CI-produced APKs, VM disks, dependency bundles or original guest recordings. Do not add these artifacts without separate permission and review.

Before a public binary or container release, generate a versioned dependency/SBOM and complete third-party notice and distribution review. The public source preview is not certification of external image licenses or redistribution rights.
