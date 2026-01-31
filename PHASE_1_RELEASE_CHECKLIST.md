# Phase 1 Release Checklist

> Estimatix Phase 1: Manual Pricing + Automation + Truth Capture  
> Reference: `.cursor/PRODUCT_CONTEXT.md`

---

## 1. Core Functionality

### Estimate Creation
- [ ] Create new project with metadata (client, address, dates)
- [ ] Create estimate from voice recording transcription
- [ ] Create estimate from manual line item entry
- [ ] Parse blueprint uploads for room/area data

### Line Item Editing
- [ ] Add/edit/delete line items
- [ ] Assign cost codes to line items
- [ ] Assign room names to line items
- [ ] Set quantity and unit for each item
- [ ] Edit direct cost (manual entry)
- [ ] Edit margin percentage
- [ ] Client price calculates correctly

### Manual Pricing
- [ ] Direct cost field is editable
- [ ] Labor/material breakdown optional
- [ ] Margin applies correctly to generate client price
- [ ] Allowance items work (0% margin, pass-through)

### Document Generation
- [ ] Generate Proposal PDF from estimate
- [ ] Generate Contract PDF from proposal
- [ ] Generate Invoice PDF for billing
- [ ] Generate Spec Sheet from estimate

### Project Organization
- [ ] Projects list with search/filter
- [ ] Project detail page with tabs
- [ ] Rooms management (optional scoping)
- [ ] File uploads (photos, blueprints, audio)

---

## 2. Pricing Rules Verification

> Per PRODUCT_CONTEXT.md: "Pricing suggestions are feature-flagged OFF"

### Prices Start Blank (NULL ≠ 0)
- [ ] New line items have `direct_cost = null` (not 0)
- [ ] `null` means "unpriced" — `0` means "$0 (free/owner-provided)"
- [ ] UI shows "Enter price" placeholder for null values
- [ ] No auto-fill from task library on creation
- [ ] No auto-fill from user library on creation

### No Auto-Suggestions
- [ ] `ENABLE_USER_LIBRARY_SUGGESTIONS = false` in `pricingService.ts`
- [ ] `ENABLE_TASK_LIBRARY_SUGGESTIONS = false` in `pricingService.ts`
- [ ] No pricing hints shown in UI during editing

### Event Logging at Commit Moments Only
- [ ] `pricing_events` logged when Proposal is created
- [ ] `pricing_events` logged when Contract is generated
- [ ] `pricing_events` NOT logged on every blur/keystroke
- [ ] Events include `stage` metadata (proposal_created, contract_generated, etc.)

### User Library Updates at Truth States Only
- [ ] `user_cost_library` updated at `bid_final` transition
- [ ] `user_cost_library` updated at `contract_signed` transition
- [ ] NO library updates during draft editing
- [ ] NO toast prompts to save prices during editing

---

## 3. Data Integrity

### RLS Verified
- [ ] `projects` — user can only access own projects
- [ ] `estimates` — user can only access estimates for own projects
- [ ] `estimate_line_items` — user can only access items for own estimates
- [ ] `pricing_events` — SELECT/INSERT only for `auth.uid() = user_id`
- [ ] `user_cost_library` — SELECT/INSERT/UPDATE only for `auth.uid() = user_id`
- [ ] `project_actuals` — SELECT/INSERT/UPDATE only for project owner
- [ ] `line_item_actuals` — SELECT/INSERT/UPDATE only for project owner

### No Client-Side user_id Writes
- [ ] All API routes derive `user_id` from session, not request body
- [ ] Server actions use `requireAuth()` to get user
- [ ] No client-side code passes `user_id` to mutation endpoints

### Feature Flags OFF by Default
- [ ] `ENABLE_USER_LIBRARY_SUGGESTIONS = false`
- [ ] `ENABLE_TASK_LIBRARY_SUGGESTIONS = false`
- [ ] No experimental features enabled without flag

---

## 4. UX Sanity

### No Aggressive Popups
- [ ] No modal prompts when editing prices
- [ ] No blocking dialogs during estimate work
- [ ] Toast notifications are informational only (success/error)

### No Forced Pricing Suggestions
- [ ] User can enter any price without system override
- [ ] No "suggested price" shown next to input fields
- [ ] No "accept suggestion" buttons in Phase 1

### Clear Draft vs Finalized States
- [ ] Estimate status badge shows current state (draft/bid_final/contract_signed/completed)
- [ ] Draft estimates are fully editable
- [ ] `bid_final` estimates show "Finalized" indicator
- [ ] `contract_signed` estimates show "Contract Signed" indicator
- [ ] `completed` estimates show "Completed" indicator
- [ ] Close Out action only available for `contract_signed` estimates

---

## 5. Pre-Ship Tests

### Happy Path Test
1. [ ] Create new project with client info
2. [ ] Record voice memo → transcribe → generate estimate
3. [ ] Edit line items (add room, adjust quantity, set price manually)
4. [ ] Create proposal → download PDF
5. [ ] Create contract from proposal → download PDF
6. [ ] Start job → track tasks
7. [ ] Close out project with actuals
8. [ ] Verify `pricing_events` logged at proposal/contract creation
9. [ ] Verify `project_actuals` stored correctly

### Edge Cases
- [ ] Empty estimate (0 line items) → graceful handling
- [ ] Very large estimate (100+ line items) → performance OK
- [ ] Zero-price line items → allowed without error
- [ ] Allowance items → 0% margin applied correctly
- [ ] Invalid status transition → blocked with clear error
- [ ] Duplicate close out attempt → idempotent or blocked

### Rollback Safety
- [ ] Migrations are additive (no destructive changes)
- [ ] New columns have defaults (existing data unaffected)
- [ ] Feature flags allow disabling new features without deploy
- [ ] No breaking changes to existing API contracts

---

## 6. Post-Ship Monitoring

### Tables to Monitor
| Table | What to Watch |
|-------|---------------|
| `pricing_events` | Row count growth, ensure only at commit moments |
| `user_cost_library` | Entries created only at truth states |
| `project_actuals` | Variance distribution (are estimates accurate?) |
| `estimates` | Status distribution (draft vs finalized) |

### Errors to Watch
- [ ] `Invalid estimate status transition` — should be rare (UI bug if frequent)
- [ ] `Unauthorized` errors — RLS working correctly
- [ ] PDF generation failures — template or data issues
- [ ] Supabase rate limits — if growth exceeds plan

### Data Volume Expectations (First 30 Days)
| Metric | Expected Range |
|--------|----------------|
| Projects created | 10-100 per user |
| Estimates per project | 1-3 |
| Line items per estimate | 20-200 |
| Pricing events | 1-2 per estimate (at commit) |
| User library entries | ~50% of unique tasks priced |

---

## Sign-Off

- [ ] **Dev**: All checklist items verified
- [ ] **QA**: Happy path and edge cases passed
- [ ] **Product**: UX meets Phase 1 goals (manual-first, no AI suggestions)

**Release Date**: _______________  
**Released By**: _______________

---

*Phase 2 Preview: Enable pricing suggestions behind feature flag, add accuracy dashboards, regional aggregation.*
