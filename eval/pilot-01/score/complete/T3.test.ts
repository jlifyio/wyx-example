// T3 completion: getOrderReceipt joins the order with its payment record.
import { expect, test } from "bun:test";
const R = process.env.RUN_TREE!;
const { insertOrder } = await import(`${R}/src/orders/repository.ts`);
const { insertPayment } = await import(`${R}/src/payments/repository.ts`);
const svc = await import(`${R}/src/orders/service.ts`);
const t0 = new Date("2026-01-02T03:04:05Z");
const seed = async () => {
  const id = crypto.randomUUID(); const pid = crypto.randomUUID();
  const items = [{ productId: "p1", quantity: 2, price: 21 }];
  await insertOrder({ id, customerId: "c9", items, status: "paid", total: 42, createdAt: new Date(), updatedAt: new Date() });
  await insertPayment({ id: pid, orderId: id, amount: 42, status: "completed", processedAt: t0, updatedAt: t0 });
  return { id, pid, items };
};
test("c1 receipt fields", async () => {
  const { id, pid, items } = await seed();
  const r = await svc.getOrderReceipt(id, pid);
  expect(r).toMatchObject({ orderId: id, customerId: "c9", items, total: 42, amountPaid: 42, paymentStatus: "completed" });
  expect(new Date(r.paidAt).getTime()).toBe(t0.getTime());
});
test("c2 unknown order / unknown payment rejected", async () => {
  const { id, pid } = await seed();
  await expect(svc.getOrderReceipt("nope", pid)).rejects.toThrow();
  await expect(svc.getOrderReceipt(id, "nope")).rejects.toThrow();
});
test("c3 payment of another order rejected", async () => {
  const a = await seed(); const b = await seed();
  await expect(svc.getOrderReceipt(a.id, b.pid)).rejects.toThrow();
});
test("c4 existing API kept", () => { for (const f of ["createOrder", "getOrder", "getOrderTotal", "cancelOrder"]) expect(typeof svc[f]).toBe("function"); });
