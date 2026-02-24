// Inventory repository — data access layer
// Owns the stock table. No other module should access this directly.

export interface StockRecord {
  productId: string;
  available: number;
  reserved: number;
}

export async function findStock(productId: string): Promise<StockRecord | null> {
  // SELECT * FROM stock WHERE product_id = $1
  return { productId, available: 100, reserved: 0 };
}

export async function updateStock(
  productId: string,
  available: number,
  reserved: number
): Promise<void> {
  // UPDATE stock SET available = $1, reserved = $2, updated_at = NOW() WHERE product_id = $3
}
