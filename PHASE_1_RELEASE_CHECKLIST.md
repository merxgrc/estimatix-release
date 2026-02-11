# Estimatix Phase 1 — Release Checklist

> **Phase 1 Goal**  
> Fast, reliable estimate creation with **rooms, line items, manual pricing, and scoped automation**.  
> Phase 1 captures truthful estimate data and supports scope changes — without pricing intelligence.

> Reference: `.cursor/PRODUCT_CONTEXT.md`

---

## 1. Core Functionality (Phase 1 Scope)

### Projects & Tracking
- [ ] Create new project with metadata (client, address, dates)
- [ ] Project persists and is user-owned
- [ ] Projects list view (search/filter optional)
- [ ] Project detail page with Phase 1 tabs only
- [ ] Project status tracking (`draft`, `bid_final`, `contract_signed`, `completed`)

---

### Estimates (Core)
- [ ] Create estimate inside a project
- [ ] Support multiple estimates per project
- [ ] Estimate persists and reloads correctly
- [ ] Estimate totals computed from **included rooms only**

---

### Rooms / Areas (Required)
- [ ] Create rooms manually or via chat
- [ ] Assign line items to rooms
- [ ] Room subtotal calculated correctly
- [ ] Room has `is_included` toggle (exclude ≠ delete)
- [ ] Excluding a room updates:
  - Estimate totals
  - Proposal / contract / spec documents
  - All summary UI locations
- [ ] Excluded rooms can be re-included without data loss

> **Rule:** `is_included` is the single source of truth for scope.

---

### Line Items
- [ ] Add / edit / delete line items
- [ ] Line items belong to a room
- [ ] Line items include:
  - description
  - quantity
  - unit (optional)
  - direct cost (manual)
  - margin %
  - client price (calculated)
- [ ] Totals update immediately on edit
- [ ] Zero-price items allowed (explicit $0)

---

### Chat → Structured Actions (OpenAI Required)
- [ ] Chat uses OpenAI to parse user intent
- [ ] Chat can:
  - create rooms
  - add line items
  - assign items to rooms
  - update quantities
  - exclude / include rooms
- [ ] Chat replies with confirmation of actions taken
- [ ] Chat **does not** suggest prices
- [ ] Chat never auto-fills pricing fields

> Chat is task-focused, not a general assistant.

---

### File Uploads (As-Is)
- [ ] Upload photos
- [ ] Upload blueprints
- [ ] Upload audio (if already implemented)
- [ ] Files correctly linked to project / estimate
- [ ] No requirement for AI blueprint parsing in Phase 1

---

## 2. Manual Pricing Rules (Strict)

### Prices Start Blank
- [ ] New line items have `direct_cost = null`
- [ ] `null` = unpriced, `0` = free
- [ ] UI clearly distinguishes null vs zero
- [ ] No auto-fill from task library
- [ ] No auto-fill from user cost library

---

### No Pricing Suggestions
- [ ] No “suggested price” UI anywhere
- [ ] No accept/edit/reject flows
- [ ] No market comparisons
- [ ] No historical pricing surfaced in UI

---

### Margin & Allowances
- [ ] Margin applies correctly to client price
- [ ] Allowance items:
  - 0% margin
  - pass-through pricing
  - behave correctly in totals

---

## 3. Documents (Computed from Included Scope)

- [ ] Proposal PDF generated from estimate
- [ ] Contract PDF generated from proposal
- [ ] Spec sheet generated from estimate
- [ ] Invoice PDF generated (if included)
- [ ] All documents:
  - reflect included rooms only
  - update automatically when rooms are excluded/included
  - never reference excluded scope

---

## 4. UI Scope Enforcement

### Navigation (Phase 1 Only)
- [ ] Removed from top nav:
  - Pricing
  - Selections
- [ ] Removed from sidebar:
  - Market
  - Historical Data
  - Legacy / duplicate estimate flows
- [ ] Sidebar includes only:
  - Projects
  - Estimate
  - Documents
  - Settings / Account

> Old routes may exist but must not be visible in Phase 1 UI.

---

## 5. Data Integrity & Security

### RLS Verified
- [ ] `projects` — user owns project
- [ ] `estimates` — user owns estimate
- [ ] `rooms` — user owns via project
- [ ] `estimate_line_items` — user owns via estimate
- [ ] `pricing_events` — insert/select only for owner
- [ ] `user_cost_library` — NOT written during Phase 1 drafting

---

### Server-Side Authority
- [ ] `user_id` derived from auth session only
- [ ] No client-side `user_id` writes
- [ ] All mutations guarded by server auth

---

## 6. UX Guardrails
- [ ] No blocking modals during estimating
- [ ] No forced prompts to save pricing
- [ ] Toasts are informational only
- [ ] Draft vs finalized state clearly indicated

---

## 7. Pre-Ship Tests

### Happy Path
1. [ ] Create project
2. [ ] Create estimate
3. [ ] Add rooms via chat
4. [ ] Add line items via chat
5. [ ] Manually enter prices
6. [ ] Exclude a room → totals + docs update
7. [ ] Generate proposal PDF
8. [ ] Generate contract PDF
9. [ ] Reload page → state persists

---

### Edge Cases
- [ ] Empty estimate handled gracefully
- [ ] Large estimates perform acceptably
- [ ] Zero-price items allowed
- [ ] Duplicate status transitions blocked
- [ ] Excluding all rooms → total = 0 with clear UI

---

## 8. Rollback Safety
- [ ] All migrations additive
- [ ] No destructive schema changes
- [ ] Feature flags exist for Phase 2 features
- [ ] Phase 1 deploy can be reverted safely

---

## Sign-Off
- [ ] Engineering verified
- [ ] Product verified
- [ ] QA passed

**Release:** Estimatix Phase 1  
**Date:** __________  
**Owner:** __________  

---

### Phase 2 (Explicitly Out of Scope)
Pricing suggestions, historical analysis, market data, semantic search, optimization, analytics dashboards.
