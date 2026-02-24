// Notification service — sends order confirmations, payment receipts, etc.
import { sendEmail } from "./email";
import { sendSms } from "./sms";
import { renderTemplate } from "./templates";

export async function notifyOrderConfirmed(orderId: string, email: string) {
  const html = renderTemplate("order-confirmed", { orderId });
  await sendEmail(email, "Order Confirmed", html);
}

export async function notifyPaymentReceived(paymentId: string, email: string, phone?: string) {
  const html = renderTemplate("payment-received", { paymentId });
  await sendEmail(email, "Payment Received", html);
  if (phone) await sendSms(phone, `Payment ${paymentId} received`);
}

export async function notifyOrderShipped(orderId: string, email: string, trackingNumber: string) {
  const html = renderTemplate("order-shipped", { orderId, trackingNumber });
  await sendEmail(email, "Order Shipped", html);
}
