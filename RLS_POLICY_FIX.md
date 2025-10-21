# 🔧 RLS Policy Fix for Estimates

## ✅ **Issue Identified**

The 500 error is caused by RLS (Row Level Security) policy blocking inserts with `project_id: null`.

### 🐛 **Root Cause**
The estimates table RLS policy requires estimates to belong to a project, but we're creating standalone estimates with `project_id: null`.

### 🔧 **Fix Required**

Run this SQL in your Supabase SQL Editor:

```sql
-- Drop the existing policy
DROP POLICY IF EXISTS "Users can insert estimates for their projects" ON estimates;

-- Create new policy that allows null project_id
CREATE POLICY "Users can insert estimates for their projects" ON estimates
    FOR INSERT WITH CHECK (
        estimates.project_id IS NULL OR
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = estimates.project_id 
            AND projects.user_id = auth.uid()
        )
    );
```

### 🎯 **What This Fixes**
- ✅ **Allows standalone estimates** - `project_id: null` is now permitted
- ✅ **Maintains security** - Still requires project ownership when project_id is set
- ✅ **Enables workflow** - Record → Parse → Estimate now works

### 🧪 **Test After Fix**
1. Run the SQL command above in Supabase
2. Try the record → parse → estimate flow again
3. The 500 error should be resolved

The RLS policy now allows both:
- **Standalone estimates** (project_id = null)
- **Project estimates** (project_id = valid project ID owned by user)
