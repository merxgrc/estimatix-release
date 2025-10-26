# 🔧 RLS (Row Level Security) Fix Explanation

## 🚨 **Root Cause Analysis**

The `StorageApiError: new row violates row-level security policy` error was caused by **three critical issues**:

### 1. **Missing `user_id` Column in `uploads` Table**
- The `uploads` table was missing a `user_id` column
- RLS policies couldn't verify user ownership
- Database inserts were failing because there was no way to associate uploads with users

### 2. **Incorrect Storage File Paths**
- Storage policies expected files in user-specific folders: `{user_id}/filename`
- Code was uploading directly to bucket root: `filename`
- This caused storage policy violations

### 3. **Incomplete RLS Policies**
- Storage policies were too restrictive
- Database policies didn't account for the new `user_id` column
- Missing policies for general file uploads

## ✅ **Fixes Applied**

### **1. Updated Voice Recorder Code**
```typescript
// BEFORE: Uploaded to bucket root
const fileName = `recording-${timestamp}.${fileExt}`

// AFTER: Uploaded to user-specific folder
const fileName = `${user.id}/recording-${timestamp}.${fileExt}`

// BEFORE: Missing user_id in database insert
.insert({
  project_id: projectId || null,
  file_url: urlData.publicUrl,
  kind: 'audio',
})

// AFTER: Includes user_id
.insert({
  project_id: projectId || null,
  file_url: urlData.publicUrl,
  kind: 'audio',
  user_id: user.id, // ✅ Added user_id
})
```

### **2. Database Schema Updates**
```sql
-- Add user_id column to uploads table
ALTER TABLE uploads ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Update existing records (if any)
UPDATE uploads 
SET user_id = projects.user_id 
FROM projects 
WHERE uploads.project_id = projects.id;

-- Make user_id required
ALTER TABLE uploads ALTER COLUMN user_id SET NOT NULL;

-- Add performance index
CREATE INDEX idx_uploads_user_id ON uploads(user_id);
```

### **3. Corrected RLS Policies**

#### **Storage Policies (Fixed)**
```sql
-- Users can upload to their own folders
CREATE POLICY "Users can upload audio files" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'audio-uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );
```

#### **Database Policies (Fixed)**
```sql
-- Users can only access their own uploads
CREATE POLICY "Users can view their own uploads" ON uploads
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own uploads" ON uploads
    FOR INSERT WITH CHECK (auth.uid() = user_id);
```

## 🎯 **What Was Missing**

### **Before Fix:**
1. ❌ No `user_id` in uploads table
2. ❌ Files uploaded to wrong paths
3. ❌ RLS policies couldn't verify ownership
4. ❌ Database inserts failed silently

### **After Fix:**
1. ✅ `user_id` column added and populated
2. ✅ Files uploaded to user-specific folders
3. ✅ RLS policies correctly verify ownership
4. ✅ Database inserts work with proper authentication

## 📋 **SQL Commands to Run**

**Copy and paste this entire block into your Supabase SQL Editor:**

```sql
-- 1. Add user_id column to uploads table
ALTER TABLE uploads ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Update existing uploads to have user_id (if any exist)
UPDATE uploads 
SET user_id = projects.user_id 
FROM projects 
WHERE uploads.project_id = projects.id;

-- 3. Make user_id NOT NULL after setting existing records
ALTER TABLE uploads ALTER COLUMN user_id SET NOT NULL;

-- 4. Create index for better performance
CREATE INDEX idx_uploads_user_id ON uploads(user_id);

-- 5. Drop and recreate storage policies for audio-uploads bucket
DROP POLICY IF EXISTS "Users can upload audio files" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own audio files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own audio files" ON storage.objects;

-- 6. Create correct storage policies for audio-uploads bucket
CREATE POLICY "Users can upload audio files" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'audio-uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can view their own audio files" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'audio-uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete their own audio files" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'audio-uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

-- 7. Update uploads table RLS policies to include user_id checks
DROP POLICY IF EXISTS "Users can view uploads for their projects" ON uploads;
DROP POLICY IF EXISTS "Users can insert uploads for their projects" ON uploads;
DROP POLICY IF EXISTS "Users can update uploads for their projects" ON uploads;
DROP POLICY IF EXISTS "Users can delete uploads for their projects" ON uploads;

-- 8. Create new uploads policies with user_id checks
CREATE POLICY "Users can view their own uploads" ON uploads
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own uploads" ON uploads
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own uploads" ON uploads
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own uploads" ON uploads
    FOR DELETE USING (auth.uid() = user_id);

-- 9. Create additional storage bucket for general uploads (photos, blueprints)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO NOTHING;

-- 10. Create storage policies for general uploads bucket
CREATE POLICY "Users can upload files" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can view their own files" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete their own files" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );
```

## 🧪 **Testing Steps**

After running the SQL fixes:

1. **Sign in** to your app
2. **Navigate to `/record`**
3. **Record audio** using the voice recorder
4. **Click "Save Recording"**
5. **Verify upload succeeds** (no more RLS errors)
6. **Check Supabase Storage** - files should be in `{user_id}/` folders
7. **Check uploads table** - records should have `user_id` populated

## 🔍 **Verification**

### **In Supabase Dashboard:**
1. **Storage** → `audio-uploads` bucket → Should see user-specific folders
2. **Table Editor** → `uploads` table → Should see `user_id` column populated
3. **Authentication** → Users → Should see proper user associations

### **In Your App:**
1. **No more RLS errors** during uploads
2. **Files appear in correct user folders**
3. **Database records properly linked to users**

## ✅ **Expected Results**

After applying these fixes:
- ✅ **No more RLS policy violations**
- ✅ **Audio files upload successfully**
- ✅ **Files stored in user-specific folders**
- ✅ **Database records properly associated with users**
- ✅ **Full upload flow works end-to-end**

The RLS system now properly secures both storage and database operations while allowing authenticated users to manage their own files and records.
