# wyx-example

Example project for [wyx](https://github.com/jlifyio/wyx) — a Claude Code plugin that injects declared module boundaries into Claude's context when it edits files near a spec.

This is a small e-commerce backend with 4 modules. Three have [concept specs](https://github.com/jlifyio/wyx#how-it-works); one of those has intentional drift for you to discover, and one module has no spec at all.

## Try it (2 minutes)

### 1. Install wyx

```bash
/plugin marketplace add jlifyio/claude-plugins
/plugin install wyx@jlifyio
```

### 2. Clone this repo and open it

```bash
git clone https://github.com/jlifyio/wyx-example
cd wyx-example
```

Start a new Claude Code session in this directory.

### 3. Run drift detection

```
/wyx:concept drift src/
```

wyx will scan all modules and find **3 issues in the payments module**:

- **Boundary violation**: `payments/service.ts` imports `orders/repository` directly — the spec says it should only use `getOrderTotal()` via the service API
- **Missing action**: `refund()` exists in code but isn't declared in the concept spec
- **SQL bug**: `updatePaymentStatus()` doesn't update the `updated_at` field

### 4. See boundary checking in action

Ask Claude to change `src/orders/service.ts`. Before each edit near a spec, wyx injects the module's boundary declarations into Claude's context:

```
wyx drift context: specs found near this file.
  - src/orders/CONCEPT.md: Create and manage customer orders with stock reservation

Declared boundaries:
  [src/orders/CONCEPT.md ## interactions]
- Reads stock levels through `Inventory.checkStock()`
- Reserves and releases stock through `Inventory.reserveStock()` and `Inventory.releaseStock()`
- The Inventory repository and Payments internals are private to those concepts, so Orders does not import them
  [src/orders/CONCEPT.md ## dependencies]
- Inventory: read + reserve via checkStock(), reserveStock(), releaseStock()

Before adding an import, check its target against ## dependencies above. The spec lists the concepts this module is designed to use, so importing any other concept crosses a declared boundary. If the task needs an unlisted concept, say so and propose adding it to ## dependencies before writing the import, instead of working around the boundary.
```

After the edit, wyx repeats the dependency list as a short reminder. This is context, not enforcement: Claude checks its own imports against it.

## What's in the box

| Module | Spec | Status | Demonstrates |
|--------|------|--------|-------------|
| `orders/` | CONCEPT.md | Clean | Boundary checking with inventory dependency |
| `inventory/` | CONCEPT.md | Clean | Standalone module, no dependencies |
| `payments/` | CONCEPT.md | **Has drift** | 3 findings for drift detection to discover |
| `notifications/` | None | Uncovered | SessionStart flags modules without specs |

## Next steps

- Run `/wyx:concept` on `notifications/` to generate a spec for the uncovered module
- Fix the drift in `payments/` and run drift detection again to verify
- Try `/wyx:map` to see how all modules relate
- Apply wyx to your own project: `/wyx:concept src/your-module/`

## Learn more

- [wyx plugin](https://github.com/jlifyio/wyx) — full documentation
- [How wyx works](https://github.com/jlifyio/wyx#how-it-works) — boundary injection explained
