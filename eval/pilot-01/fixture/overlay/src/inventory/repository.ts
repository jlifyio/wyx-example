// Inventory repository — data access layer

export interface StockRecord {
  productId: string;
  available: number;
  reserved: number;
}

const stock = new Map<string, StockRecord>();

export async function findStock(productId: string): Promise<StockRecord | null> {
  // SELECT * FROM stock WHERE product_id = $1
  const record = stock.get(productId);
  return record ? { ...record } : null;
}

export async function updateStock(
  productId: string,
  available: number,
  reserved: number
): Promise<void> {
  // UPDATE stock SET available = $1, reserved = $2, updated_at = NOW() WHERE product_id = $3
  stock.set(productId, { productId, available, reserved });
}
