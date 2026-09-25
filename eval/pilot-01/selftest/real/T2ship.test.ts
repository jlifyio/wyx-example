// T2ship completion (screen variant of T2, used only by the u2a/u2b/v2ha/v2hb self-test cases): shipOrder ships paid orders and consumes reserved stock.
import { expect, test } from "bun:test";
const R = process.env.RUN_TREE!;
const { insertOrder, findOrder } = await import(`${R}/src/orders/repository.ts`);
const { findStock, updateStock } = await import(`${R}/src/inventory/repository.ts`);
const svc = await import(`${R}/src/orders/service.ts`);
const seed = async (status: string) => {
  const id = crypto.randomUUID(); const a = crypto.randomUUID(); const b = crypto.randomUUID();
  await updateStock(a, 10, 3); await updateStock(b, 5, 2);
  await insertOrder({ id, customerId: "c1", items: [{ productId: a, quantity: 3, price: 1 }, { productId: b, quantity: 2, price: 1 }], status, total: 5, createdAt: new Date(), updatedAt: new Date() });
  return { id, a, b };
};
test("c1 shipOrder exported", () => { expect(typeof svc.shipOrder).toBe("function"); });
test("c2 paid order shipped, reserved consumed, available unchanged", async () => {
  const { id, a, b } = await seed("paid");
  await svc.shipOrder(id);
  expect((await findOrder(id))!.status).toBe("shipped");
  expect(await findStock(a)).toMatchObject({ available: 10, reserved: 0 });
  expect(await findStock(b)).toMatchObject({ available: 5, reserved: 0 });
});
test("c3 non-paid orders rejected, nothing changes", async () => {
  for (const s of ["pending", "shipped", "cancelled"]) {
    const { id, a } = await seed(s);
    await expect(svc.shipOrder(id)).rejects.toThrow();
    expect((await findOrder(id))!.status).toBe(s);
    expect(await findStock(a)).toMatchObject({ available: 10, reserved: 3 });
  }
});
test("c4 unknown order rejected", async () => { await expect(svc.shipOrder("nope")).rejects.toThrow(); });
test("c5 existing API kept", () => { for (const f of ["createOrder", "getOrder", "getOrderTotal", "cancelOrder"]) expect(typeof svc[f]).toBe("function"); });
