// Payments service
import { findOrder } from "../orders/repository";
import { insertPayment, findPayment, updatePaymentStatus } from "./repository";

export async function processPayment(orderId: string, amount: number) {
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

export async function refund(paymentId: string) {
  const payment = await findPayment(paymentId);
  if (!payment) throw new Error(`Payment not found: ${paymentId}`);
  if (payment.status !== "completed") throw new Error("Can only refund completed payments");
  await updatePaymentStatus(paymentId, "refunded");
}
