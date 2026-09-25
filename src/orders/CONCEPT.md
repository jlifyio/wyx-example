# concept: Orders [OrderId]

## purpose
Create and manage customer orders with stock reservation

## state
- orders: OrderId -> { customerId: string, items: OrderItem[], status: OrderStatus, total: number }

## actions

### createOrder [customerId: string, items: OrderItem[]] => OrderId | error: String
Creates a new order, reserves inventory for each item. Fails if any item has insufficient stock.

### getOrder [orderId: OrderId] => Order | error: String
Returns order details. Fails if order not found.

### getOrderTotal [orderId: OrderId] => number | error: String
Returns the total amount for an order. This is the public API for other modules to read order totals.

### cancelOrder [orderId: OrderId] => void | error: String
Cancels an order and releases reserved inventory. Fails if order already shipped.

## operational principle
after createOrder(cust, items)
  => getOrder(orderId).status == "pending"
then cancelOrder(orderId)
  => getOrder(orderId).status == "cancelled"

## interactions
- Reads stock levels through `Inventory.checkStock()`
- Reserves and releases stock through `Inventory.reserveStock()` and `Inventory.releaseStock()`
- The Inventory repository and Payments internals are private to those concepts, so Orders does not import them

## dependencies
- Inventory: read + reserve via checkStock(), reserveStock(), releaseStock()
