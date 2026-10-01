"use server";

import { verifyPreviewPrivateStorage } from "@/domains/preview-storage";

export async function runPreviewStorageCheck() {
  return verifyPreviewPrivateStorage();
}
