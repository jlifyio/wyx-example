// Payments repository — data access layer

export interface PaymentRecord {
  id: string;
  orderId: string;
  amount: number;
  status: "pending" | "completed" | "failed" | "refunded";
  processedAt: Date;
  updatedAt: Date;
}

const payments = new Map<string, PaymentRecord>();

export async function insertPayment(payment: PaymentRecord): Promise<void> {
  // INSERT INTO payments (id, order_id, amount, status, processed_at, updated_at)
  // VALUES ($1, $2, $3, $4, $5, NOW())
  payments.set(payment.id, structuredClone(payment));
}

export async function findPayment(paymentId: string): Promise<PaymentRecord | null> {
  // SELECT * FROM payments WHERE id = $1
  const payment = payments.get(paymentId);
  return payment ? structuredClone(payment) : null;
}

export async function updatePaymentStatus(
  paymentId: string,
  status: PaymentRecord["status"]
): Promise<void> {
  // UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2
  const payment = payments.get(paymentId);
  if (payment) payments.set(paymentId, { ...payment, status, updatedAt: new Date() });
}
