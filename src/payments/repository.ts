// Payments repository — data access layer

export interface PaymentRecord {
  id: string;
  orderId: string;
  amount: number;
  status: "pending" | "completed" | "failed" | "refunded";
  processedAt: Date;
  updatedAt: Date;
}

export async function insertPayment(payment: PaymentRecord): Promise<void> {
  // INSERT INTO payments (id, order_id, amount, status, processed_at, updated_at)
  // VALUES ($1, $2, $3, $4, $5, NOW())
}

export async function findPayment(paymentId: string): Promise<PaymentRecord | null> {
  // SELECT * FROM payments WHERE id = $1
  return null;
}

export async function updatePaymentStatus(
  paymentId: string,
  status: PaymentRecord["status"]
): Promise<void> {
  // BUG: missing updated_at — this is intentional drift item #3
  // UPDATE payments SET status = $1 WHERE id = $2
  // Should be: UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2
}
