import { createResumeStore } from "@/resume/storage";

export type VariantOption = { variantId: string; name: string };

/** The user's resume variants for the per-run override. Any storage problem just means "no choice offered". */
export async function loadVariantOptions(): Promise<VariantOption[]> {
  try {
    return (await createResumeStore().listVariants()).map((v) => ({ variantId: v.variantId, name: v.name }));
  } catch {
    return [];
  }
}
