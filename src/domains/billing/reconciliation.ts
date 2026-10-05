export * from "./reconciliation-base";

import { finishPendingProviderOperations as finishBase } from "./reconciliation-base";
import { reconcileMovedDepositRefundOperations } from "./deposit-refund-reconciliation";

/**
 * R06 first repairs/retries renewal-moved deposit refunds through their
 * immutable source receipt. The existing reconciliation pass then handles every
 * other provider operation exactly as before. A moved refund that still fails
 * remains visible to the base pass, whose legacy current-agreement lookup cannot
 * invent a different source charge.
 */
export async function finishPendingProviderOperations(
  limit = 50,
): Promise<{ completed: number; stillUnknown: number }> {
  const moved = await reconcileMovedDepositRefundOperations(limit);
  const base = await finishBase(limit);
  return {
    completed: moved.completed + base.completed,
    stillUnknown: base.stillUnknown,
  };
}
