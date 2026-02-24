# wyx-example

Example project for [wyx](https://github.com/jlifyio/wyx) — architecture boundary checking for Claude Code.

This is a small e-commerce backend with 4 modules. Three have [concept specs](https://github.com/jlifyio/wyx#how-wyx-solves-it); one has intentional drift for you to discover.

## Try it (2 minutes)

### 1. Install wyx

```bash
/plugin marketplace add jlifyio/wyx
/plugin install wyx@wyx
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

Try editing `src/orders/service.ts`. When Claude writes or edits a file, wyx automatically injects the module's boundary declarations into Claude's context:

```
[src/orders/CONCEPT.md ## interactions]
- READS stock levels FROM Inventory (via checkStock service API only)
- RESERVES inventory FROM Inventory (via reserveStock service API only)
- NEVER directly accesses Inventory repository or Payments internals

[src/orders/CONCEPT.md ## dependencies]
- Inventory: read + reserve via checkStock(), reserveStock(), releaseStock()
```

Claude sees these boundaries before every write — and respects them automatically.

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
- [How wyx works](https://github.com/jlifyio/wyx#how-wyx-solves-it) — boundary checking explained
