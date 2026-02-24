// Orders repository — data access layer
// Owns the orders table. No other module should access this directly.

export interface OrderRecord {
  id: string;
  customerId: string;
  items: Array<{ productId: string; quantity: number; price: number }>;
  status: "pending" | "paid" | "shipped" | "cancelled";
  total: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function insertOrder(order: OrderRecord): Promise<void> {
  // INSERT INTO orders (id, customer_id, items, status, total, created_at, updated_at)
  // VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
}

export async function findOrder(orderId: string): Promise<OrderRecord | null> {
  // SELECT * FROM orders WHERE id = $1
  return null;
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderRecord["status"]
): Promise<void> {
  // UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2
}
