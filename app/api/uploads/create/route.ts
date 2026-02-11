import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient, requireAuth } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    // Verify user is authenticated
    const user = await requireAuth()
    
    const { projectId, fileUrl, kind, tag, fileType, originalFilename } = await req.json()
    
    if (!projectId || !fileUrl) {
      return NextResponse.json(
        { error: 'projectId and fileUrl are required' },
        { status: 400 }
      )
    }
    
    // Use service role client to bypass RLS
    const supabase = createServiceRoleClient()
    
    // Verify user owns the project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()
    
    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found or access denied' },
        { status: 403 }
      )
    }
    
    // Build insert data - use 'kind' field which should exist, and map tag to it
    // The 'kind' field is the primary category, 'tag' is optional extra metadata
    const effectiveKind = tag || kind || 'other'
    
    const insertData: Record<string, any> = {
      project_id: projectId,
      file_url: fileUrl,
      kind: effectiveKind, // Use tag value for kind if provided
      user_id: user.id,
    }
    
    // Try adding optional fields
    if (originalFilename) insertData.original_filename = originalFilename
    
    // First try with tag and file_type columns
    let upload = null
    let insertError = null
    
    const fullData = { ...insertData }
    if (tag) fullData.tag = tag
    if (fileType) fullData.file_type = fileType
    
    const { data: fullInsert, error: fullError } = await supabase
      .from('uploads')
      .insert(fullData)
      .select()
      .single()
    
    if (!fullError) {
      upload = fullInsert
    } else if (fullError.message.includes('schema cache') || fullError.message.includes('column')) {
      // Schema issue with tag/file_type - try without them
      console.log('Schema issue detected, retrying without tag/file_type columns:', fullError.message)
      
      const { data: basicInsert, error: basicError } = await supabase
        .from('uploads')
        .insert(insertData)
        .select()
        .single()
      
      upload = basicInsert
      insertError = basicError
      
      if (!basicError) {
        console.log('Insert succeeded with kind =', effectiveKind)
      }
    } else {
      insertError = fullError
    }
    
    if (insertError) {
      console.error('Insert error:', insertError)
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      )
    }
    
    // Auto-create plan_parses row for blueprint/plan uploads (Stage 0)
    const blueprintKinds = ['blueprint', 'plan', 'plans', 'floor_plan']
    if (upload && blueprintKinds.includes(effectiveKind.toLowerCase())) {
      try {
        const { error: planParseError } = await supabase
          .from('plan_parses')
          .insert({
            project_id: projectId,
            upload_id: upload.id,
            file_urls: [fileUrl],
            status: 'uploaded',
          })
        
        if (planParseError) {
          // Non-fatal: log but don't fail the upload
          console.warn('Failed to auto-create plan_parses row:', planParseError.message)
        }
      } catch (planParseErr) {
        console.warn('Error creating plan_parses row:', planParseErr)
      }
    }

    return NextResponse.json({ success: true, upload })
  } catch (error) {
    console.error('Upload create error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
