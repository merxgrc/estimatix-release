# Phase 1 Blueprint Parsing QA Checklist

## Overview

This document outlines the QA steps for Phase 1 blueprint/plan parsing functionality.

**Key Phase 1 Rules:**
- NO pricing suggestions or auto-fill (all costs are null until user enters them)
- User MUST review detected rooms before applying
- "Remove room" = exclude from scope (`is_active = false`)
- Excluded rooms must update ALL documents (proposal/contract/spec sheet/invoice)

---

## Test Cases

### 1. Upload & Parse Large PDF (40+ Pages)

**Steps:**
1. Navigate to a project → Files tab
2. Upload a construction plan PDF (40+ pages recommended)
3. Tag the file as "Blueprint" or "Spec"
4. Select the file checkbox
5. Click "Parse Blueprint" button

**Expected Results:**
- [ ] Loading indicator appears
- [ ] Toast shows progress (e.g., "Detecting rooms...")
- [ ] Processing completes within 2 minutes
- [ ] Review drawer opens automatically
- [ ] Stats show: `X pages scanned • Y pages analyzed • Z.Xs`

**If parsing fails:**
- [ ] User-friendly error message appears (not technical errors)
- [ ] Fallback "General / Scope Notes" room is created
- [ ] Actionable next steps are suggested

---

### 2. Verify Review Screen

**Steps:**
1. After parsing, examine the Review drawer

**Expected Results:**
- [ ] Rooms tab shows detected rooms with checkboxes (default: checked)
- [ ] Each room displays: name, type, area (if available), confidence badge
- [ ] Low confidence rooms show warning badge
- [ ] "Rename" button allows inline editing
- [ ] "Merge Duplicates" mode allows selecting 2+ rooms to combine
- [ ] Line Items tab groups suggested items by room
- [ ] All line items show NO pricing (quantities only)
- [ ] Warnings/missing info/assumptions are visible at top
- [ ] "Re-parse" button is available
- [ ] Stats bar shows page count and processing time

---

### 3. Apply Rooms to Estimate

**Steps:**
1. In Review drawer, uncheck any rooms you don't want
2. Optionally rename rooms
3. Click "Apply X Rooms & Y Items"

**Expected Results:**
- [ ] Success toast appears with counts
- [ ] New rooms appear in Rooms tab
- [ ] New line items appear in Estimate tab (grouped by room)
- [ ] All line items have NULL costs (direct_cost = null, client_price = null)
- [ ] Existing rooms/items are preserved (APPEND mode, not overwrite)

---

### 4. Exclude Room & Verify Document Updates

**Steps:**
1. Go to Rooms tab
2. Find an applied room
3. Toggle "Hide Scope" switch to exclude the room
4. Generate/view each document type:
   - Proposal PDF
   - Contract PDF  
   - Spec Sheet PDF
   - Invoice (if job started)

**Expected Results:**
- [ ] Room shows "Hidden" badge in Rooms tab
- [ ] Room's line items no longer count toward estimate totals
- [ ] **Proposal PDF**: Excluded room's items NOT listed, total updated
- [ ] **Contract PDF**: Excluded room's items NOT in scope list
- [ ] **Spec Sheet PDF**: Excluded room's items NOT in sections
- [ ] **Invoice PDF**: If job already started, invoice only bills included items

---

### 5. Verify "Docs Out of Date" Indicator

**Steps:**
1. Create a proposal from an estimate
2. Go to Rooms tab and toggle a room's inclusion
3. Return to Proposals tab

**Expected Results:**
- [ ] Proposal row shows amber "Out of date" badge
- [ ] Hovering over "View PDF" shows tooltip explaining current scope is used
- [ ] Downloaded PDF reflects CURRENT included scope (not stale snapshot)

---

### 6. Error Handling - Missing OpenAI Key

**Test Environment:**
- Temporarily remove `OPENAI_API_KEY` from environment

**Steps:**
1. Try to parse a blueprint

**Expected Results:**
- [ ] API returns 503 status (not 500)
- [ ] User sees: "AI service unavailable"
- [ ] Build does NOT fail at import time
- [ ] App continues to function (just parsing disabled)

---

### 7. Error Handling - Scanned/Image-Only PDF

**Steps:**
1. Upload a PDF that's image-only (scanned document)
2. Parse it

**Expected Results:**
- [ ] Warning appears: "PDF appears to be scanned/image-only"
- [ ] Suggestion to upload individual page images
- [ ] Fallback room created if no rooms detected
- [ ] NO crash or unhandled exception

---

### 8. Error Handling - Corrupted PDF

**Steps:**
1. Upload a corrupted or invalid PDF file
2. Attempt to parse it

**Expected Results:**
- [ ] User-friendly error: "This file couldn't be read properly"
- [ ] Suggestion to re-save or try different version
- [ ] Fallback response with General room
- [ ] NO crash or stack trace shown to user

---

## Manual Testing Checklist

### Pre-Deploy
- [ ] `npm run build` passes without errors
- [ ] No new TypeScript errors introduced
- [ ] No console errors in browser dev tools during normal use

### Post-Deploy (Vercel)
- [ ] Production build deploys successfully
- [ ] Blueprint parsing works in production
- [ ] PDFs generate correctly (all document types)
- [ ] Room inclusion/exclusion persists across page refresh

---

## Known Limitations (Phase 1)

1. **Image-only PDFs**: Limited text extraction; better to upload individual images
2. **Very large PDFs (100+ pages)**: May timeout; recommend splitting
3. **Complex drawings**: AI may miss rooms with unusual labeling
4. **No OCR**: Scanned documents require clear text or image upload

---

## Support Escalation

If a user reports parsing issues:

1. **Check file type**: Is it a valid PDF with embedded text?
2. **Check file size**: Very large files may need splitting
3. **Check image quality**: Blurry scans won't parse well
4. **Suggest workaround**: Upload individual floor plan images
5. **Manual entry**: Always available as fallback

---

*Last Updated: Phase 1 Release*
