# Phase 1 Release Checklist

> **Estimatix / Field Pro Builder — Phase 1 QA**
> Copy this into a GitHub Issue for tracking.

---

## 🔴 Non-Negotiable Release Blockers

### 1. Blueprint Parser — Level Detection

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1.1 | Upload a **multi-level PDF** (e.g. a 2-story house with separate floor plan sheets for each level) | Parser detects separate sheets |
| 1.2 | Check **server logs** for `[Plans Parse] ═══ SHEET CLASSIFICATION SUMMARY ═══` | Each sheet shows `detected_level` = "Level 1" / "Level 2" / "Basement" etc. |
| 1.3 | Review parsed rooms in the Review dialog | Rooms are grouped by level; e.g. "Kitchen – Level 1", "Master Bedroom – Level 2" |
| 1.4 | Use the **Debug Parse Page** (`/debug/parse`) — upload same PDF | "Rooms by Level" card shows correct count per level |
| 1.5 | Check "Page Classifications" table | Floor plan pages are classified with correct `detectedLevel` |

**Automated:** `npx playwright test -g "debug parse page loads"` confirms the debug page renders.

---

### 2. Blueprint Parser — Exact Room Count

| Step | Action | Expected Result |
|------|--------|-----------------|
| 2.1 | Upload a plan that shows **5 bathrooms** across levels | Parser returns exactly 5 bathroom entries |
| 2.2 | Check `/debug/parse` → "Rooms by Type" | Shows `bathroom: 5` |
| 2.3 | Check individual sheet detail | Each bathroom has a distinct name: "Bathroom 1 – Level 1", "Bathroom 2 – Level 1", "Bathroom 3 – Level 2", etc. |
| 2.4 | Confirm no rooms are merged | The `roomCount` in the response matches the plan count |
| 2.5 | Check server logs for `[Plans Parse] ═══ FINAL ROOM SUMMARY ═══` | `Bathrooms: 5` is printed |

**Automated:** `[Plans Parse]   Bathrooms: N` in server logs. Debug page shows exact counts.

---

### 3. Room Naming — Contextual & Deterministic

| Step | Action | Expected Result |
|------|--------|-----------------|
| 3.1 | Parse any multi-room plan | Room names include level suffix: "Bedroom 1 – Level 2" |
| 3.2 | Verify no generic names like "Room 1" or random strings | Names are professional: "Master Bedroom", "Kitchen", "Bathroom 1 – Level 1" |
| 3.3 | Re-parse the same PDF twice | Room names are **identical** both times (deterministic) |

---

### 4. All Rooms Across All Levels Captured

| Step | Action | Expected Result |
|------|--------|-----------------|
| 4.1 | Upload a plan with Basement + Level 1 + Level 2 | All three levels appear in results |
| 4.2 | Check that upstairs bathrooms/bedrooms are not missing | Every room visible in the original PDF is present |
| 4.3 | Check server logs for `[Plans Parse]   Level "Level 2": N rooms` | Level 2 rooms are listed individually |

---

### 5. Room Dimensions — Editable & Stored

| Step | Action | Expected Result |
|------|--------|-----------------|
| 5.1 | Go to **Rooms tab** → click a room | Detail panel shows Length, Width, Ceiling Height inputs |
| 5.2 | Enter Length = 12, Width = 15, Ceiling Height = 9 | Fields accept input and save |
| 5.3 | Refresh page | Values persist |
| 5.4 | Check derived areas in the panel | Floor Area = 180 sqft, Wall Area = 486 sqft, Ceiling Area = 180 sqft |

**Automated:** `npx playwright test -g "room detail panel shows dimension fields"`

---

### 6. Derived Areas — Auto-Compute on Dimension Change

| Step | Action | Expected Result |
|------|--------|-----------------|
| 6.1 | With room from 5.2, change Width from 15 → 20 | Areas auto-update: Floor = 240, Wall = 576, Ceiling = 240 |
| 6.2 | Change Ceiling Height from 9 → 10 | Wall Area updates: 2 × (12 + 20) × 10 = 640 |
| 6.3 | Check the database (Supabase dashboard or API) | `floor_area_sqft`, `wall_area_sqft`, `ceiling_area_sqft` match expected values |

---

### 7. Paint / Area-Based Line Items — Auto Quantity

| Step | Action | Expected Result |
|------|--------|-----------------|
| 7.1 | Create or find a line item with description "Paint Walls", unit "SQFT", in a room with dimensions | Quantity auto-populates from `wall_area_sqft` |
| 7.2 | Check the `calc_source` badge next to quantity | Shows **"Auto"** badge |
| 7.3 | Go to Rooms tab → change that room's Length from 12 → 14 | Return to Estimate tab → that Paint item's quantity is updated (new wall area) |
| 7.4 | Add a "Tile Floor" item with unit "SQFT" | Quantity = `floor_area_sqft` of the assigned room |
| 7.5 | Check server logs for `[ApplyParsed]   Auto-calc:` lines | Shows auto-calc items with their derived quantities |

**Automated:** `npx playwright test -g "calc_source badges are visible"`

---

### 8. Manual Override — calc_source Switch

| Step | Action | Expected Result |
|------|--------|-----------------|
| 8.1 | Find a line item with "Auto" badge | Badge is green/visible |
| 8.2 | Edit the quantity manually (type a new number) | Badge changes to **"Manual"** |
| 8.3 | Click the "↻" toggle button next to the badge | `calc_source` switches back to "Auto", quantity re-derives from room area |
| 8.4 | Verify the re-derived quantity matches the room's area | Quantity = room area for the mapped field (wall/floor/ceiling) |

**Automated:** `npx playwright test -g "editing quantity field changes calc_source badge"`

---

### 9. Exclude Room from Scope — Cascade Updates

| Step | Action | Expected Result |
|------|--------|-----------------|
| 9.1 | Go to **Rooms tab** → find a room with line items | Room has scope toggle Switch |
| 9.2 | Toggle the scope Switch **OFF** | Switch turns off, room visually marked as excluded |
| 9.3 | Switch to **Estimate tab** | Line items for that room show "Excluded" badge |
| 9.4 | Check the Grand Total | Total **excludes** that room's line items. Excluded count shown. |
| 9.5 | Create a **Proposal** | Proposal total excludes the room's items |
| 9.6 | Create a **Contract** | Contract total excludes the room's items |
| 9.7 | Generate a **Spec Sheet PDF** | PDF total excludes the room's items |
| 9.8 | Toggle the scope Switch back **ON** | All totals re-include the room's items immediately |

**Automated:** `npx playwright test -g "toggling room scope updates totals"`

---

### 10. Inline Editing — All Numeric Fields

| Step | Action | Expected Result |
|------|--------|-----------------|
| 10.1 | Go to **Estimate tab** | Table (desktop) or cards (mobile) load |
| 10.2 | Click into **Quantity** field → change value | Saves on blur, no page reload |
| 10.3 | Click into **Direct Cost** → change value | Line total recalculates immediately |
| 10.4 | Click into **Margin %** → change value | Client Price recalculates: `direct_cost × (1 + margin/100)` |
| 10.5 | Edit **Description** (text field) | Saves on blur |
| 10.6 | Check that Grand Total updates | Reflects all inline edits |

**Automated:** `npx playwright test -g "estimate line item fields are editable"`

---

### 11. Line Items — Room Assignment

| Step | Action | Expected Result |
|------|--------|-----------------|
| 11.1 | Every line item has a `room_name` and `room_id` | No orphaned items without room assignment |
| 11.2 | Items group by room in the Estimate table | Room headers separate line items |
| 11.3 | Adding via Copilot assigns `room_id` | New items have correct room FK |

---

### 12. Grand Total — Immediate Recalc

| Step | Action | Expected Result |
|------|--------|-----------------|
| 12.1 | Edit any line item cost | Grand Total updates within 1 second |
| 12.2 | Exclude a room from scope | Grand Total drops that room's items immediately |
| 12.3 | Re-include the room | Grand Total adds them back |

**Automated:** `npx playwright test -g "grand total is visible"`

---

## 🟡 UI / Responsive

### 13. Mobile Usability (375px)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 13.1 | Open app on 375px width (Chrome DevTools) | No horizontal scrollbar |
| 13.2 | Navigate: Dashboard → Projects → Project Detail | All pages load, no overflow |
| 13.3 | Estimate tab on mobile | Shows **card view** (not table) |
| 13.4 | Rooms tab on mobile | Two-pane layout stacks vertically |
| 13.5 | All buttons/inputs | Min 44px tap target height |
| 13.6 | Bottom navigation | Visible on mobile, hidden on desktop |
| 13.7 | Modals/Dialogs | Full-screen or near full-screen on mobile |

**Automated:** `npx playwright test -g "no horizontal scrollbar at 375px"`

---

## 🟢 Automated Test Suite

### Running Playwright Tests

```bash
# Install (one-time)
npx playwright install chromium

# Run all smoke tests (requires dev server on :3000)
TEST_EMAIL=you@example.com TEST_PASSWORD=secret npm run test:e2e

# Run headed (see the browser)
npm run test:e2e:headed

# Run with UI (interactive)
npm run test:e2e:ui

# Run a specific test
npx playwright test -g "room dimensions"
```

### Test Coverage Map

| Test File | Non-Negotiables Covered |
|-----------|------------------------|
| `tests/e2e/phase1-smoke.spec.ts` | 1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13 |

---

## 🔧 Debug Tools

### Debug Parse Page (`/debug/parse`)

- **URL:** `http://localhost:3000/debug/parse`
- **Purpose:** Upload a PDF blueprint and see structured parse output without touching the database
- **Shows:** Sheet classification, level detection, room extraction, room counts by level/type, page classifications, raw JSON

### Test Parse API (`POST /api/plans/test-parse`)

- **Purpose:** Same as debug page but API-only (for scripting/CI)
- **Input:** multipart/form-data with `file` field
- **Output:** JSON with sheets, rooms, roomsByLevel, roomsByType

### Structured Server Logs

Look for these log patterns in the server console during blueprint parsing:

```
[Plans Parse] ═══ SHEET CLASSIFICATION SUMMARY ═══
[Plans Parse]   Sheet p2: "FIRST FLOOR PLAN" → Level 1 (floor_plan, confidence: 90)
[Plans Parse]   Sheet p3: "SECOND FLOOR PLAN" → Level 2 (floor_plan, confidence: 85)

[Plans Parse] ═══ ROOM EXTRACTION RESULTS ═══
[Plans Parse]   Sheet p2 "FIRST FLOOR PLAN" (Level 1): 8 rooms → 2 bedroom, 2 bathroom, 1 kitchen, ...
[Plans Parse]     • "Kitchen – Level 1" (kitchen) dims=12' x 14' area=168sqft
[Plans Parse]     • "Bathroom 1 – Level 1" (bathroom) dims=8' x 10' area=80sqft

[Plans Parse] ═══ FINAL ROOM SUMMARY (after dedup) ═══
[Plans Parse]   Total unique rooms: 14
[Plans Parse]   Level 1: 8 rooms → Kitchen – Level 1, Living Room – Level 1, ...
[Plans Parse]   Level 2: 6 rooms → Master Bedroom – Level 2, Bedroom 2 – Level 2, ...
[Plans Parse]   Bathrooms: 5
[Plans Parse]   Bedrooms: 4
```

When applying parsed results:

```
[ApplyParsed] Level "Level 1" → 8 rooms: Kitchen – Level 1, Bathroom 1 – Level 1, ...
[ApplyParsed] Level "Level 2" → 6 rooms: Master Bedroom – Level 2, ...
[ApplyParsed] Total rooms in input: 14, included: 14, excluded: 0
[ApplyParsed] Rooms created: 14, excluded: 0, skipped (existing): 0
[ApplyParsed] Line items to insert: 42 (12 area-based auto-calc, 30 manual)
[ApplyParsed]   Auto-calc: "Paint Walls" → room "Kitchen – Level 1" → qty=432 SQFT
[ApplyParsed] ✅ Complete: 14 rooms, 42 line items, 0 excluded
```

---

## 📋 Places Where Totals Are Computed (Scope-Filtered)

All of these locations filter line items by `rooms.is_in_scope = true`:

| Location | File | How Filtered |
|----------|------|-------------|
| EstimateTable grand total | `components/estimate/EstimateTable.tsx` | Client-side `roomScopeMap` filter |
| Estimate record total | `actions/estimate-line-items.ts` → `refreshEstimateTotal()` | Fetches rooms, builds scope map, filters |
| Create Proposal | `actions/proposals.ts` → `createProposalFromEstimate()` | Joins `rooms(is_in_scope)`, filters client-side |
| Regenerate Proposal Total | `actions/proposals.ts` → `regenerateProposalTotal()` | Same join + filter |
| Create Contract | `actions/contracts.ts` → `regenerateContractTotal()` | Same join + filter |
| Proposal PDF | `app/api/proposals/[id]/pdf/route.ts` | Same join + filter |
| Contract PDF | `app/api/contracts/[id]/pdf/route.ts` | Same join + filter |
| Spec Sheet PDF | `app/api/spec-sheets/[estimateId]/pdf/route.ts` | Same join + filter |
| Start Job | `actions/start-job.ts` | Same join + filter |
| Dashboard Accuracy | `actions/dashboard.ts` → `getEstimationAccuracy()` | Same join + filter |
| Pricing Tab | `_components/PricingTab.tsx` | Uses `roomActiveMap` from `is_in_scope` |
| Create Proposal Dialog | `_components/CreateProposalDialog.tsx` | Same join + filter |
| Toggle Room Scope | `actions/rooms.ts` → `toggleRoomScope()` | Cascades → calls `refreshEstimateTotal()` |

---

## ✅ Sign-Off

- [ ] All non-negotiables (1–12) pass manual QA
- [ ] Playwright smoke tests pass: `npm run test:e2e`
- [ ] No TypeScript errors: `npx tsc --noEmit`
- [ ] No linter errors: `npm run lint`
- [ ] Debug parse page verified with real blueprints
- [ ] Mobile responsive at 375px — no horizontal scroll
- [ ] Server logs show structured parse output during blueprint processing
