'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'

export function SupabaseTest() {
  const [testResults, setTestResults] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const { user } = useAuth()

  const addResult = (message: string) => {
    setTestResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`])
  }

  const runTests = async () => {
    setIsLoading(true)
    setTestResults([])
    
    try {
      // Test 1: Check authentication
      addResult('Testing authentication...')
      if (!user) {
        addResult('❌ No authenticated user found')
        return
      }
      addResult(`✅ User authenticated: ${user.email}`)

      // Test 2: Check Supabase connection
      addResult('Testing Supabase connection...')
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) {
        addResult(`❌ Session error: ${sessionError.message}`)
        return
      }
      addResult(`✅ Session active: ${session ? 'Yes' : 'No'}`)

      // Test 3: Check Supabase client configuration
      addResult('Testing Supabase client configuration...')
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      addResult(`Supabase URL: ${supabaseUrl ? 'Set' : 'Missing'}`)
      addResult(`Supabase Key: ${supabaseKey ? 'Set' : 'Missing'}`)

      // Test 4: List storage buckets with detailed error handling
      addResult('Testing storage buckets...')
      const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets()
      
      if (bucketsError) {
        addResult(`❌ Buckets error: ${bucketsError.message}`)
        addResult(`❌ Error details: ${JSON.stringify(bucketsError)}`)
        
        // Try alternative approach
        addResult('Trying alternative bucket access...')
        try {
          const { data: testData, error: testError } = await supabase.storage.from('audio-uploads').list()
          if (testError) {
            addResult(`❌ Direct bucket access failed: ${testError.message}`)
          } else {
            addResult('✅ Direct bucket access works (bucket exists but listBuckets() failed)')
          }
        } catch (err) {
          addResult(`❌ Direct bucket test failed: ${err}`)
        }
        return
      }
      
      addResult(`✅ Found ${buckets.length} buckets: ${buckets.map(b => b.name).join(', ')}`)

      // Test 5: Check if audio-uploads bucket exists
      const audioBucket = buckets.find(b => b.name === 'audio-uploads')
      if (!audioBucket) {
        addResult('❌ audio-uploads bucket not found in list')
        addResult('This means the bucket either:')
        addResult('1. Does not exist in your Supabase project')
        addResult('2. Exists but you do not have permission to list it')
        addResult('3. Exists in a different Supabase project')
        return
      }
      addResult('✅ audio-uploads bucket exists')

      // Test 5: Test file upload with small test file
      addResult('Testing file upload...')
      const testContent = 'test audio content'
      const testBlob = new Blob([testContent], { type: 'audio/wav' })
      const testFileName = `${user.id}/test-${Date.now()}.wav`
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('audio-uploads')
        .upload(testFileName, testBlob, {
          contentType: 'audio/wav',
          upsert: false
        })

      if (uploadError) {
        addResult(`❌ Upload error: ${uploadError.message}`)
        return
      }
      addResult('✅ Test file uploaded successfully')

      // Test 6: Test database insert with detailed error info
      addResult('Testing database insert...')
      const { data: urlData } = supabase.storage
        .from('audio-uploads')
        .getPublicUrl(testFileName)

      addResult(`Attempting to insert with user_id: ${user.id}`)
      
      const { data: insertData, error: dbError } = await supabase
        .from('uploads')
        .insert({
          project_id: null,
          file_url: urlData.publicUrl,
          kind: 'audio',
          user_id: user.id,
        })
        .select()

      if (dbError) {
        addResult(`❌ Database error: ${dbError.message}`)
        addResult(`❌ Error code: ${dbError.code}`)
        addResult(`❌ Error details: ${JSON.stringify(dbError)}`)
        addResult(`❌ Error hint: ${dbError.hint}`)
        
        // Try without user_id to see if that's the issue
        addResult('Trying insert without user_id...')
        const { data: insertData2, error: dbError2 } = await supabase
          .from('uploads')
          .insert({
            project_id: null,
            file_url: urlData.publicUrl,
            kind: 'audio',
          })
          .select()
        
        if (dbError2) {
          addResult(`❌ Insert without user_id also failed: ${dbError2.message}`)
        } else {
          addResult('✅ Insert without user_id worked - user_id column issue')
        }
        return
      }
      addResult('✅ Database insert successful')

      // Test 7: Clean up test file
      addResult('Cleaning up test file...')
      const { error: deleteError } = await supabase.storage
        .from('audio-uploads')
        .remove([testFileName])

      if (deleteError) {
        addResult(`⚠️ Cleanup warning: ${deleteError.message}`)
      } else {
        addResult('✅ Test file cleaned up')
      }

      addResult('🎉 All tests passed! Upload should work now.')

    } catch (err) {
      addResult(`❌ Test failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      console.error('Test error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const createBucketManually = async () => {
    setIsLoading(true)
    setTestResults([])
    
    try {
      addResult('Attempting to create audio-uploads bucket manually...')
      
      // Try to create the bucket using SQL
      const { data, error } = await supabase.rpc('create_bucket_if_not_exists', {
        bucket_name: 'audio-uploads',
        is_public: true
      })
      
      if (error) {
        addResult(`❌ RPC error: ${error.message}`)
        addResult('This means the RPC function does not exist')
        addResult('You need to create the bucket manually in Supabase Dashboard')
        return
      }
      
      addResult('✅ Bucket creation attempted')
      addResult('Now run the connection test again to verify')
      
    } catch (err) {
      addResult(`❌ Manual creation failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Supabase Connection Test</CardTitle>
        <CardDescription>
          Test your Supabase connection, storage, and database setup
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Button 
            onClick={runTests} 
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? 'Running Tests...' : 'Run Connection Tests'}
          </Button>
          
          <Button 
            onClick={createBucketManually} 
            disabled={isLoading}
            variant="outline"
            className="w-full"
          >
            Try Manual Bucket Creation
          </Button>
        </div>
        
        {testResults.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-medium">Test Results:</h4>
            <div className="bg-muted p-4 rounded-lg max-h-64 overflow-y-auto">
              {testResults.map((result, index) => (
                <div key={index} className="text-sm font-mono">
                  {result}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
