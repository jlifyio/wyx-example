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
- READS stock levels FROM Inventory (via checkStock service API only)
- RESERVES inventory FROM Inventory (via reserveStock service API only)
- NEVER directly accesses Inventory repository or Payments internals

## dependencies
- Inventory: read + reserve via checkStock(), reserveStock(), releaseStock()
