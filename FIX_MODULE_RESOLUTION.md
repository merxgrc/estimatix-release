# Fix Module Resolution Issues

## Problem
Next.js webpack is having trouble resolving modules even though files exist:
- `@/components/ui/progress`
- `@/components/ui/radio-group`
- `@/components/invoices/CreateInvoiceDrawer`
- `./_components/ManageTab`

## Solution

All files have been verified to exist and have proper exports. The issue is webpack cache.

### Steps to Fix:

1. **Stop the dev server completely** (Ctrl+C)

2. **Clear all caches:**
```bash
cd /home/mrx/Projects/estimatix-mobile/estimatix-mobile
rm -rf .next
rm -rf node_modules/.cache
rm -rf .turbo
```

3. **Restart the dev server:**
```bash
npm run dev
```

## Verified Files

All these files exist and have proper exports:
- ✅ `components/ui/progress.tsx` - exports `Progress`
- ✅ `components/ui/radio-group.tsx` - exports `RadioGroup, RadioGroupItem`
- ✅ `components/invoices/CreateInvoiceDrawer.tsx` - exports `CreateInvoiceDrawer`
- ✅ `app/projects/[id]/_components/ManageTab.tsx` - exports `ManageTab`
- ✅ `components/estimate/SmartRoomInput.tsx` - exports `SmartRoomInput`

## If Issues Persist

If the errors continue after restarting:

1. Check that the dev server is completely stopped (no processes on port 3000)
2. Try deleting `node_modules` and reinstalling:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   npm run dev
   ```

3. Check browser console for any additional errors

