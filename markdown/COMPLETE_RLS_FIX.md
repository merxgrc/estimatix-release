# 🔧 Complete RLS Policy Fix

## 🚨 **Issue: Still Getting RLS Policy Error**

The RLS policy is still blocking inserts. We need to update ALL policies for the estimates table.

## 🔧 **Complete SQL Fix**

Run this complete SQL in your Supabase SQL Editor:

```sql
-- Drop ALL existing policies for estimates table
DROP POLICY IF EXISTS "Users can view estimates for their projects" ON estimates;
DROP POLICY IF EXISTS "Users can insert estimates for their projects" ON estimates;
DROP POLICY IF EXISTS "Users can update estimates for their projects" ON estimates;
DROP POLICY IF EXISTS "Users can delete estimates for their projects" ON estimates;

-- Create new policies that allow null project_id
CREATE POLICY "Users can view estimates for their projects" ON estimates
    FOR SELECT USING (
        estimates.project_id IS NULL OR
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = estimates.project_id 
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert estimates for their projects" ON estimates
    FOR INSERT WITH CHECK (
        estimates.project_id IS NULL OR
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = estimates.project_id 
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update estimates for their projects" ON estimates
    FOR UPDATE USING (
        estimates.project_id IS NULL OR
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = estimates.project_id 
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete estimates for their projects" ON estimates
    FOR DELETE USING (
        estimates.project_id IS NULL OR
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = estimates.project_id 
            AND projects.user_id = auth.uid()
        )
    );
```

## 🎯 **What This Fixes**

- ✅ **Allows null project_id** for standalone estimates
- ✅ **Maintains security** for project-based estimates
- ✅ **Updates all CRUD operations** (SELECT, INSERT, UPDATE, DELETE)
- ✅ **Comprehensive fix** for all RLS policies

## 🧪 **Test After Running**

1. Run the complete SQL above
2. Try the record → parse → estimate flow again
3. The RLS error should be resolved
4. You should see the estimate table with parsed items

**This should be the final fix!**
