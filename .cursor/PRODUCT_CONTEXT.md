# Estimatix Product Context (READ FIRST)

## Product Vision
Estimatix is a contractor-first estimating and project automation platform.
The system prioritizes trust, correctness, and long-term learning over early AI guessing.

Estimates are not just numbers — they are outcomes that progress through stages:
draft → bid_final → contract_signed → actuals.

## Current Phase: PHASE 1 — Manual Pricing + Automation + Truth Capture

### Phase 1 Goals
- Contractors manually enter prices.
- Estimatix provides value through:
  - fast line item creation
  - document generation (proposals, contracts, invoices, spec sheets)
  - organization and reuse
- The system captures pricing behavior and truth safely for future learning.

### Pricing Rules (IMPORTANT)
- Do NOT auto-fill or guess prices by default.
- Unit costs start blank unless explicitly entered by the user.
- Pricing suggestions are feature-flagged OFF.
- We collect data, but we do not influence bids yet.

### Data Maturity Model
Pricing data has stages:
- draft (user typing / editing)
- bid_final (user finalized bid)
- contract_signed (contract generated)
- actual (post-job real costs)

Only bid_final and contract_signed data should be treated as pricing truth.

### Allowed Data Collection
- Log pricing_events at all stages (with stage metadata).
- Save to user_cost_library ONLY at commit moments:
  - Finalize Bid
  - Generate Contract
  - Mark Accepted

### Explicit Non-Goals (Do NOT implement yet)
- No regional pricing aggregates
- No k-anonymity logic
- No auto-suggested pricing
- No ML-driven bid optimization
- No aggressive popups or blocking pricing UX

## Engineering Principles
- Prefer explicit user actions over inference.
- Capture events first, optimize later.
- Feature-flag future behavior instead of removing it.
- Minimal refactors; ship usable increments.

If instructions conflict:
→ Follow PRODUCT_CONTEXT.md
