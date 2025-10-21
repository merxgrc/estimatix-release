# 🔍 Debug Upload Errors - Step-by-Step Guide

## 🚨 **Current Issue: `Upload error: {}`**

The empty error object suggests one of these common issues:

1. **Storage bucket doesn't exist**
2. **RLS policies not applied correctly**
3. **User authentication issues**
4. **Network/connection problems**

## 🛠️ **Debugging Steps**

### **Step 1: Run the Connection Test**

I've added a debug component to your `/record` page. Follow these steps:

1. **Navigate to `/record`** in your app
2. **Look for the "Supabase Connection Test" card** at the top
3. **Click "Run Connection Tests"**
4. **Check the results** - this will tell us exactly what's failing

### **Step 2: Check Console Logs**

The improved error handling now provides detailed logging. Open your browser's Developer Tools (F12) and look for:

```
Starting upload process... { user: "user-id", audioSize: 12345 }
Uploading to storage: user-id/recording-timestamp.webm
Storage upload successful: { path: "..." }
Generated public URL: https://...
Database insert successful: [...]
```

### **Step 3: Verify Supabase Setup**

#### **A. Check Storage Bucket Exists**
1. Go to your **Supabase Dashboard**
2. Navigate to **Storage** → **Buckets**
3. Verify you see `audio-uploads` bucket
4. If missing, run the SQL commands from the previous fix

#### **B. Check Database Schema**
1. Go to **Table Editor** → **uploads**
2. Verify the table has a `user_id` column
3. If missing, run the SQL commands from the previous fix

#### **C. Check RLS Policies**
1. Go to **Authentication** → **Policies**
2. Look for policies on `uploads` table and `storage.objects`
3. Verify they include user_id checks

## 🔧 **Common Fixes**

### **Fix 1: Storage Bucket Missing**
If the test shows "audio-uploads bucket not found":

```sql
-- Run this in Supabase SQL Editor
INSERT INTO storage.buckets (id, name, public) 
VALUES ('audio-uploads', 'audio-uploads', true);
```

### **Fix 2: RLS Policies Missing**
If the test shows storage or database errors:

```sql
-- Run the complete RLS fix from the previous solution
-- (Copy the entire SQL block from RLS_FIXES.sql)
```

### **Fix 3: User Authentication Issues**
If the test shows "No authenticated user found":

1. **Sign out and sign back in**
2. **Check your `.env.local` file** has correct Supabase credentials
3. **Verify the user is properly authenticated**

## 📋 **Expected Test Results**

When everything is working correctly, you should see:

```
✅ User authenticated: your-email@example.com
✅ Session active: Yes
✅ Found X buckets: audio-uploads, uploads, ...
✅ audio-uploads bucket exists
✅ Test file uploaded successfully
✅ Database insert successful
✅ Test file cleaned up
🎉 All tests passed! Upload should work now.
```

## 🚨 **If Tests Still Fail**

### **Error: "Storage error: new row violates row-level security policy"**
- **Solution**: Run the complete RLS fix SQL commands

### **Error: "Bucket not found"**
- **Solution**: Create the storage bucket with the SQL command above

### **Error: "Database error: column user_id does not exist"**
- **Solution**: Run the complete RLS fix SQL commands

### **Error: "No authenticated user"**
- **Solution**: Check authentication flow and environment variables

## 🧪 **Testing the Upload Flow**

After the connection tests pass:

1. **Record some audio** using the voice recorder
2. **Click "Save Recording"**
3. **Check the console logs** for detailed progress
4. **Verify success message** appears
5. **Check Supabase Storage** - you should see files in user-specific folders
6. **Check uploads table** - you should see new records with user_id

## 🔄 **Remove Debug Component**

Once everything is working:

1. **Remove the `<SupabaseTest />` component** from `/record` page
2. **Delete the debug component file** if no longer needed
3. **The upload flow should work seamlessly**

## 📞 **Still Having Issues?**

If the connection tests pass but uploads still fail:

1. **Check browser network tab** for failed requests
2. **Verify file size** - very large files might timeout
3. **Check Supabase logs** in the dashboard
4. **Try a different browser** to rule out browser-specific issues

The improved error handling will now give you much more detailed information about what's failing, making it easier to identify and fix the root cause.
