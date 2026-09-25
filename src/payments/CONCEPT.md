# concept: Payments [PaymentId]

## purpose
Process payments for customer orders

## state
- payments: PaymentId -> { orderId: string, amount: number, status: PaymentStatus, processedAt: Date }

## actions

### processPayment [orderId: string, amount: number] => PaymentId | error: String
Charges the customer for an order. Reads order total from Orders to verify amount matches. Fails if amount mismatch or payment gateway error.

### getPaymentStatus [paymentId: PaymentId] => PaymentStatus
Returns current payment status (pending, completed, failed).

## operational principle
after processPayment(orderId, amount)
  => getPaymentStatus(paymentId) == "completed"

## interactions
- Reads the order total through `Orders.getOrderTotal()`
- The Orders repository and Inventory internals are private to those concepts, so Payments does not import them

## dependencies
- Orders: read-only via getOrderTotal()
