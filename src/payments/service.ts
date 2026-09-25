// Payments service

// DRIFT ITEM #1: Boundary violation — imports orders/repository directly
// CONCEPT.md says: "Reads the order total through `Orders.getOrderTotal()`"
// But this bypasses the service API and reads from the repository directly.
import { findOrder } from "../orders/repository";
import { insertPayment, findPayment, updatePaymentStatus } from "./repository";

export async function processPayment(orderId: string, amount: number) {
  // Boundary violation: accessing Orders internals instead of using getOrderTotal()
  const order = await findOrder(orderId);
  if (!order) throw new Error(`Order not found: ${orderId}`);
  if (order.total !== amount) {
    throw new Error(`Amount mismatch: expected ${order.total}, got ${amount}`);
  }

  const paymentId = crypto.randomUUID();
  await insertPayment({
    id: paymentId,
    orderId,
    amount,
    status: "completed",
    processedAt: new Date(),
    updatedAt: new Date(),
  });

  return paymentId;
}

export async function getPaymentStatus(paymentId: string) {
  const payment = await findPayment(paymentId);
  if (!payment) throw new Error(`Payment not found: ${paymentId}`);
  return payment.status;
}

// DRIFT ITEM #2: Missing action — refund() exists in code but not in CONCEPT.md
export async function refund(paymentId: string) {
  const payment = await findPayment(paymentId);
  if (!payment) throw new Error(`Payment not found: ${paymentId}`);
  if (payment.status !== "completed") throw new Error("Can only refund completed payments");
  await updatePaymentStatus(paymentId, "refunded");
}
