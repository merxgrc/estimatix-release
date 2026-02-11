import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/supabase/server'
import { loadTemplate } from '@/lib/loadTemplate'
import { renderTemplate } from '@/lib/renderTemplate'
import { launchBrowser } from '@/lib/pdf-browser'
import { getProfileByUserId } from '@/lib/profile'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: contractId } = await context.params
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Fetch contract with proposal relationship
    const { data: contract, error: contractError } = await supabase
      .from('contracts')
      .select('*, proposals(*)')
      .eq('id', contractId)
      .maybeSingle()

    if (contractError || !contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    // Fetch project
    const { data: project } = await supabase
      .from('projects')
      .select('*')
      .eq('id', contract.project_id)
      .maybeSingle()

    if (!project || project.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Fetch contractor profile
    let contractorProfile = null
    if (contract.created_by) {
      try {
        contractorProfile = await getProfileByUserId(contract.created_by)
      } catch (profileError) {
        console.warn('Failed to fetch contract creator profile:', profileError)
      }
    }

    // If no created_by, try to get profile from project owner
    if (!contractorProfile && project.user_id) {
      try {
        contractorProfile = await getProfileByUserId(project.user_id)
      } catch (profileError) {
        console.warn('Failed to fetch project owner profile:', profileError)
      }
    }

    // Fetch scope of work from linked proposal
    let scopeItems: Array<{ description: string }> = []
    let scopeText = ''

    if (contract.proposal_id) {
      const { data: proposal } = await supabase
        .from('proposals')
        .select('*, estimates(id)')
        .eq('id', contract.proposal_id)
        .maybeSingle()

      if (proposal && proposal.estimate_id) {
        // Fetch line items from the estimate (exclude allowances)
        // Join with rooms to filter out excluded rooms (is_active = false)
        const { data: lineItemsData } = await supabase
          .from('estimate_line_items')
          .select(`
            description, 
            is_allowance,
            room_id,
            rooms!estimate_line_items_room_id_fkey (
              id,
              is_active
            )
          `)
          .eq('estimate_id', proposal.estimate_id)
          .order('created_at', { ascending: true })

        if (lineItemsData && lineItemsData.length > 0) {
          // Filter out allowances, empty descriptions, and excluded rooms
          scopeItems = lineItemsData
            .filter((item: any) => {
              const desc = item.description || ''
              const isAllowance = item.is_allowance === true || 
                                 (desc.toUpperCase().trim().startsWith('ALLOWANCE:'))
              // Filter out items from excluded (inactive) rooms
              // Items without a room (room_id = null) are included by default
              const room = item.rooms as { id: string; is_active: boolean } | null
              if (room && room.is_active === false) {
                return false // Skip excluded room items
              }
              return desc.trim().length > 0 && !isAllowance
            })
            .map((item: any) => ({
              description: item.description.trim()
            }))
        }

        // Also check if proposal has body_json with scope information
        if (proposal.body_json) {
          const bodyJson = proposal.body_json as any
          if (bodyJson.basis_of_estimate) {
            scopeText = bodyJson.basis_of_estimate
          }
        }
      }
    }

    // If no scope items from proposal, use a default message
    if (scopeItems.length === 0 && !scopeText) {
      scopeText = 'Work to be performed as described in the approved proposal and specifications.'
    }

    // Extract profile information
    const profileAny = contractorProfile as any
    const companyName = profileAny?.company_name || 'Contractor'
    const companyPhone = profileAny?.phone || ''
    const contractorLicense = profileAny?.license_number || profileAny?.license || ''
    const contractorAddress = profileAny?.address || profileAny?.company_address || ''

    // Format dates
    const startDate = contract.start_date 
      ? new Date(contract.start_date).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })
      : null
    const completionDate = contract.completion_date
      ? new Date(contract.completion_date).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })
      : null

    // Parse payment schedule
    const paymentSchedule = Array.isArray(contract.payment_schedule) 
      ? contract.payment_schedule 
      : []

    // Parse legal text
    const legalText = contract.legal_text && typeof contract.legal_text === 'object'
      ? contract.legal_text
      : {}

    // Load and render template
    const templateString = loadTemplate('contract.html')
    const html = renderTemplate(templateString, {
      company_name: companyName,
      company_phone: companyPhone,
      contractor_license: contractorLicense,
      contractor_address: contractorAddress,
      client_name: project.client_name || project.owner_name || 'Client',
      project_address: project.project_address || 'Property Address',
      total_price: contract.total_price || 0,
      down_payment: contract.down_payment || 0,
      payment_schedule: paymentSchedule,
      legal_text: legalText,
      scope_items: scopeItems,
      scope_text: scopeText,
      start_date: startDate,
      completion_date: completionDate
    })

    // Generate PDF using Playwright-core + @sparticuz/chromium
    const browser = await launchBrowser()
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle' })
    const pdf = await page.pdf({ 
      format: 'Letter', 
      printBackground: true,
      margin: { top: '50px', right: '60px', bottom: '50px', left: '60px' }
    })
    await browser.close()

    // Convert Buffer -> ArrayBuffer for NextResponse
    const pdfArrayBuffer = pdf instanceof Buffer ? pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) : pdf

    return new NextResponse(pdfArrayBuffer as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Contract-${project.title || 'Contract'}-${Date.now()}.pdf"`
      }
    })
  } catch (error) {
    console.error('Error generating contract PDF:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate PDF' },
      { status: 500 }
    )
  }
}


