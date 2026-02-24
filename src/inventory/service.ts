// Inventory service — public API for stock management
import { findStock, updateStock } from "./repository";

export async function checkStock(productId: string) {
  const stock = await findStock(productId);
  if (!stock) throw new Error(`Product not found: ${productId}`);
  return { available: stock.available, reserved: stock.reserved };
}

export async function reserveStock(productId: string, quantity: number) {
  const stock = await findStock(productId);
  if (!stock) throw new Error(`Product not found: ${productId}`);
  if (stock.available < quantity) throw new Error("Insufficient stock");
  await updateStock(productId, stock.available - quantity, stock.reserved + quantity);
}

export async function releaseStock(productId: string, quantity: number) {
  const stock = await findStock(productId);
  if (!stock) throw new Error(`Product not found: ${productId}`);
  await updateStock(productId, stock.available + quantity, stock.reserved - quantity);
}
