// Orders service — public API for order management
import { insertOrder, findOrder, updateOrderStatus } from "./repository";
import { checkStock, reserveStock, releaseStock } from "../inventory/service";

export async function createOrder(
  customerId: string,
  items: Array<{ productId: string; quantity: number; price: number }>
) {
  // Check stock for all items first
  for (const item of items) {
    const stock = await checkStock(item.productId);
    if (stock.available < item.quantity) {
      throw new Error(`Insufficient stock for ${item.productId}`);
    }
  }

  // Reserve inventory
  for (const item of items) {
    await reserveStock(item.productId, item.quantity);
  }

  const orderId = crypto.randomUUID();
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  await insertOrder({
    id: orderId,
    customerId,
    items,
    status: "pending",
    total,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return orderId;
}

export async function getOrder(orderId: string) {
  const order = await findOrder(orderId);
  if (!order) throw new Error(`Order not found: ${orderId}`);
  return order;
}

export async function getOrderTotal(orderId: string): Promise<number> {
  const order = await getOrder(orderId);
  return order.total;
}

export async function cancelOrder(orderId: string) {
  const order = await getOrder(orderId);
  if (order.status === "shipped") throw new Error("Cannot cancel shipped order");

  for (const item of order.items) {
    await releaseStock(item.productId, item.quantity);
  }

  await updateOrderStatus(orderId, "cancelled");
}
