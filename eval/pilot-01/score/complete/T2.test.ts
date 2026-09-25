// T2 completion: refund() returns each item's quantity to available stock.
import { expect, test } from "bun:test";
const R = process.env.RUN_TREE!;
const { insertOrder } = await import(`${R}/src/orders/repository.ts`);
const { findStock, updateStock } = await import(`${R}/src/inventory/repository.ts`);
const { insertPayment, findPayment } = await import(`${R}/src/payments/repository.ts`);
const svc = await import(`${R}/src/payments/service.ts`);
const seed = async (payStatus: string) => {
  const oid = crypto.randomUUID(); const pid = crypto.randomUUID();
  const a = crypto.randomUUID(); const b = crypto.randomUUID();
  await updateStock(a, 10, 0); await updateStock(b, 5, 1);
  await insertOrder({ id: oid, customerId: "c1", items: [{ productId: a, quantity: 3, price: 1 }, { productId: b, quantity: 2, price: 1 }], status: "shipped", total: 5, createdAt: new Date(), updatedAt: new Date() });
  await insertPayment({ id: pid, orderId: oid, amount: 5, status: payStatus, processedAt: new Date(), updatedAt: new Date() });
  return { oid, pid, a, b };
};
test("c1 refund restocks available, reserved unchanged, payment refunded", async () => {
  const { pid, a, b } = await seed("completed");
  await svc.refund(pid);
  expect((await findPayment(pid))!.status).toBe("refunded");
  expect(await findStock(a)).toMatchObject({ available: 13, reserved: 0 });
  expect(await findStock(b)).toMatchObject({ available: 7, reserved: 1 });
});
test("c2 non-completed payment rejected, stock unchanged", async () => {
  for (const s of ["pending", "failed", "refunded"]) {
    const { pid, a } = await seed(s);
    await expect(svc.refund(pid)).rejects.toThrow();
    expect(await findStock(a)).toMatchObject({ available: 10, reserved: 0 });
  }
});
test("c3 unknown payment rejected", async () => { await expect(svc.refund("nope")).rejects.toThrow(); });
test("c4 existing API kept", () => { for (const f of ["processPayment", "getPaymentStatus", "refund"]) expect(typeof svc[f]).toBe("function"); });
