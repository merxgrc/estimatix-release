# 🔧 Storage Bucket Troubleshooting Guide

## 🚨 **Current Issue: "Found 0 buckets"**

This means your Supabase client cannot access the storage API. Here are the most likely causes and solutions:

## 🔍 **Step 1: Run Enhanced Debug Test**

1. **Go to `/record`** in your app
2. **Click "Run Connection Tests"** - this will now show detailed error information
3. **Look for specific error messages** about why buckets can't be listed

## 🛠️ **Common Solutions**

### **Solution 1: Create Bucket Manually in Supabase Dashboard**

1. **Go to your Supabase Dashboard**
2. **Navigate to Storage** → **Buckets**
3. **Click "New Bucket"**
4. **Name**: `audio-uploads`
5. **Public**: ✅ Check this box
6. **Click "Create Bucket"**

### **Solution 2: Check Environment Variables**

Verify your `.env.local` file has the correct values:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

**Make sure:**
- ✅ URL starts with `https://`
- ✅ URL ends with `.supabase.co`
- ✅ Anon key is the correct one from your project

### **Solution 3: Check Supabase Project**

1. **Verify you're using the correct Supabase project**
2. **Check the project URL matches your `.env.local`**
3. **Ensure the project is active and not paused**

### **Solution 4: Manual SQL Creation**

If the dashboard doesn't work, run this SQL in your Supabase SQL Editor:

```sql
-- Create the bucket manually
INSERT INTO storage.buckets (id, name, public) 
VALUES ('audio-uploads', 'audio-uploads', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Create policies
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
```

## 🧪 **Testing Steps**

### **After Creating the Bucket:**

1. **Refresh your app** and go to `/record`
2. **Click "Run Connection Tests"** again
3. **You should now see**: "✅ Found 1 buckets: audio-uploads"
4. **Try recording and uploading** - it should work!

### **If Still Showing "Found 0 buckets":**

1. **Check browser console** for additional errors
2. **Verify your Supabase project is active**
3. **Try a different browser** to rule out browser issues
4. **Check if you have the correct permissions** in your Supabase project

## 🔍 **Debug Information**

The enhanced debug test will now show:

- ✅ **Environment variables status**
- ✅ **Detailed error messages** from storage API
- ✅ **Alternative bucket access methods**
- ✅ **Specific failure reasons**

## 🚨 **Emergency Workaround**

If storage still doesn't work, you can temporarily disable the upload feature:

1. **Comment out the upload code** in the Recorder component
2. **Just save the transcript** to the database
3. **Fix storage later** when you have more time

## 📞 **Still Not Working?**

If you're still getting "Found 0 buckets" after trying all solutions:

1. **Check your Supabase project status** - make sure it's not paused
2. **Verify your subscription** allows storage
3. **Contact Supabase support** if it's a platform issue
4. **Try creating a new Supabase project** as a test

The enhanced debug test will give you much more specific information about what's failing!
