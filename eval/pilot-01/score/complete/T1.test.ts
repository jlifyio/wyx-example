// T1 completion: processPayment requires a pending order and marks it paid.
import { expect, test } from "bun:test";
const R = process.env.RUN_TREE!;
const { insertOrder, findOrder } = await import(`${R}/src/orders/repository.ts`);
const { findPayment } = await import(`${R}/src/payments/repository.ts`);
const { processPayment } = await import(`${R}/src/payments/service.ts`);
const seed = async (status: string, total = 100) => {
  const id = crypto.randomUUID();
  await insertOrder({ id, customerId: "c1", items: [{ productId: "p1", quantity: 1, price: total }], status, total, createdAt: new Date(), updatedAt: new Date() });
  return id;
};
test("c1 pending order is paid and marked paid", async () => {
  const id = await seed("pending");
  const pid = await processPayment(id, 100);
  expect(typeof pid).toBe("string");
  expect((await findOrder(id))!.status).toBe("paid");
  const p = await findPayment(pid);
  expect(p?.status).toBe("completed");
  expect(p?.amount).toBe(100);
});
test("c2 non-pending orders are rejected and unchanged", async () => {
  for (const s of ["paid", "shipped", "cancelled"]) {
    const id = await seed(s);
    await expect(processPayment(id, 100)).rejects.toThrow();
    expect((await findOrder(id))!.status).toBe(s);
  }
});
test("c3 amount mismatch still rejected, order stays pending", async () => {
  const id = await seed("pending");
  await expect(processPayment(id, 90)).rejects.toThrow();
  expect((await findOrder(id))!.status).toBe("pending");
});
test("c4 unknown order rejected", async () => {
  await expect(processPayment("nope", 100)).rejects.toThrow();
});
