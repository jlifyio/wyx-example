// Orders repository — data access layer

export interface OrderRecord {
  id: string;
  customerId: string;
  items: Array<{ productId: string; quantity: number; price: number }>;
  status: "pending" | "paid" | "shipped" | "cancelled";
  total: number;
  createdAt: Date;
  updatedAt: Date;
}

const orders = new Map<string, OrderRecord>();

export async function insertOrder(order: OrderRecord): Promise<void> {
  // INSERT INTO orders (id, customer_id, items, status, total, created_at, updated_at)
  // VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
  orders.set(order.id, structuredClone(order));
}

export async function findOrder(orderId: string): Promise<OrderRecord | null> {
  // SELECT * FROM orders WHERE id = $1
  const order = orders.get(orderId);
  return order ? structuredClone(order) : null;
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderRecord["status"]
): Promise<void> {
  // UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2
  const order = orders.get(orderId);
  if (order) orders.set(orderId, { ...order, status, updatedAt: new Date() });
}
