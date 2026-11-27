import { ApiError } from "./kube";
export type ManagedStorageClass = "local-path" | "vm-expandable" | "vm-managed";
export function configuredStorageClass(): ManagedStorageClass {
  const value = process.env.VM_STORAGE_CLASS ?? "local-path";
  if (value !== "local-path" && value !== "vm-expandable" && value !== "vm-managed")
    throw new ApiError(502, "Invalid operator storage profile");
  return value;
}
export function vmStorageClass(spec: unknown): ManagedStorageClass {
  const templates = (
    spec as
      | { dataVolumeTemplates?: { spec?: { storage?: { storageClassName?: string } } }[] }
      | undefined
  )?.dataVolumeTemplates;
  if (!templates?.length) throw new ApiError(422, "Persistent storage required");
  const value = templates[0]?.spec?.storage?.storageClassName;
  if (
    (value !== "local-path" && value !== "vm-expandable" && value !== "vm-managed") ||
    templates.some((t) => t.spec?.storage?.storageClassName !== value)
  )
    throw new ApiError(409, "Unrecognized managed StorageClass");
  return value;
}
