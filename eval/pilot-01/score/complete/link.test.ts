// Link check: each module service of the run tree loads without throwing, in one fresh process.
import { expect, test } from "bun:test";
const R = process.env.RUN_TREE!;
test("link orders", async () => { expect(typeof (await import(`${R}/src/orders/service.ts`))).toBe("object"); });
test("link inventory", async () => { expect(typeof (await import(`${R}/src/inventory/service.ts`))).toBe("object"); });
test("link payments", async () => { expect(typeof (await import(`${R}/src/payments/service.ts`))).toBe("object"); });
test("link notifications", async () => { expect(typeof (await import(`${R}/src/notifications/service.ts`))).toBe("object"); });
