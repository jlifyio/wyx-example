# concept: Inventory [ProductId]

## purpose
Track product stock levels and reserve inventory for orders

## state
- stock: ProductId -> { available: number, reserved: number }

## actions

### checkStock [productId: ProductId] => { available: number, reserved: number }
Returns current stock levels for a product. Fails if product not found.

### reserveStock [productId: ProductId, quantity: number] => void | error: String
Decrements available stock and increments reserved. Fails if insufficient stock.

### releaseStock [productId: ProductId, quantity: number] => void
Returns reserved stock back to available. Used when an order is cancelled.

## operational principle
after reserveStock(pid, 5)
  => checkStock(pid).available decreases by 5
then releaseStock(pid, 5)
  => checkStock(pid).available increases by 5

## interactions
- Provides stock data to other modules through `checkStock()`
- Orders and Payments internals are private to those concepts, so Inventory does not import them

## dependencies
None — standalone module
