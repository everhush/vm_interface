// Immutable OCI image ID observed in the native amd64 launcher timeline of CI
// 45504649562 (artifact 14972484061). Revalidate a new digest before changing it.
export const cirrosImage="quay.io/kubevirt/cirros-container-disk-demo@sha256:0e5ac38b20abcc7752293425b239a147868facd62cd5030dede6da6f2fc526a1";
export const fedoraImage="quay.io/kubevirt/fedora-with-test-tooling-container-disk@sha256:127af186475f0c7ac99506c0606743c5c1607a8d29c0c7b9e9f033971a213f19";
export const catalog=[{
 id:"cirros-smoke",os:"CirrOS",version:null,architecture:"amd64",format:"oci-container-disk",
 source:"https://quay.io/repository/kubevirt/cirros-container-disk-demo",
 image:cirrosImage,digest:"sha256:0e5ac38b20abcc7752293425b239a147868facd62cd5030dede6da6f2fc526a1",integrity:"oci-manifest-digest",
 licensing:{status:"review-required",source:"https://github.com/cirros-dev/cirros",note:"Public test image; bundled component license review and OS version metadata remain incomplete"},
 support:"smoke-only",evidence:{runId:"45504649562",artifactId:"14972484061",note:"Digest observed in actual launcher; digest-pinned create and CDI import require new validation"}
},{
 id:"fedora-exchange-test",os:"Fedora",version:"44",architecture:"amd64",format:"oci-container-disk",
 source:"https://quay.io/repository/kubevirt/fedora-with-test-tooling-container-disk",
 image:fedoraImage,digest:"sha256:127af186475f0c7ac99506c0606743c5c1607a8d29c0c7b9e9f033971a213f19",integrity:"oci-manifest-digest",
 licensing:{status:"review-required",source:"https://docs.fedoraproject.org/en-US/legal/",note:"Public KubeVirt test image; bundled tooling review incomplete"},
 support:"exchange-test-only",evidence:{runId:"45544070366",artifactId:"14990384014",note:"Native guest VirtioFS verified; persistent CDI boot and product exchange pending"}
}] as const;
