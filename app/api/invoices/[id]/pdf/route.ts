import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/supabase/server'
import { loadTemplate } from '@/lib/loadTemplate'
import { renderTemplate } from '@/lib/renderTemplate'
import { chromium } from 'playwright'
import { getProfileByUserId } from '@/lib/profile'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await context.params
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Fetch invoice with items and project
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        *,
        invoice_items (
          *,
          project_tasks (
            id,
            price,
            billed_amount,
            description
          )
        ),
        projects (*)
      `)
      .eq('id', invoiceId)
      .maybeSingle()

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const project = invoice.projects as any
    if (!project || project.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Fetch contractor profile for company info and logo
    let contractorProfile = null
    if (invoice.created_by) {
      try {
        contractorProfile = await getProfileByUserId(invoice.created_by)
      } catch (profileError) {
        console.warn('Failed to fetch invoice creator profile:', profileError)
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

    // Process invoice items with % billed calculation
    const invoiceItems = (invoice.invoice_items as any[] || []).map((item: any) => {
      const task = item.project_tasks
      const taskPrice = task?.price || 0
      const itemAmount = Number(item.amount) || 0
      
      // Calculate % billed: (item amount / task price) * 100
      // If task price is 0 or task doesn't exist, show 100% or N/A
      let percentBilled = 0
      if (task && taskPrice > 0) {
        percentBilled = Math.round((itemAmount / taskPrice) * 100)
      } else {
        percentBilled = 100 // If no task price, assume 100%
      }

      return {
        description: item.description || task?.description || 'Service',
        amount: itemAmount,
        percent_billed: percentBilled,
        task_price: taskPrice
      }
    })

    // Extract profile information
    const profileAny = contractorProfile as any
    const companyName = profileAny?.company_name || 'Contractor'
    const companyPhone = profileAny?.phone || ''
    const companyAddress = profileAny?.address || profileAny?.company_address || ''
    const companyWebsite = profileAny?.website || profileAny?.company_website || ''
    const companyLogoUrl = profileAny?.company_logo_url || profileAny?.logo_url || null
    
    // Payment instructions - check for bank details in profile or use default
    const bankAccount = profileAny?.bank_account || profileAny?.bank_account_number || null
    const bankRouting = profileAny?.bank_routing || profileAny?.bank_routing_number || null
    const bankName = profileAny?.bank_name || null
    const paymentInstructions = profileAny?.payment_instructions || null

    // Format dates
    const invoiceDate = invoice.issued_date
      ? new Date(invoice.issued_date).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })
      : new Date().toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })

    const dueDate = invoice.due_date
      ? new Date(invoice.due_date).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })
      : null

    // Load and render template
    const templateString = loadTemplate('invoice.html')
    const html = renderTemplate(templateString, {
      // Company info
      company_name: companyName,
      company_address: companyAddress,
      company_phone: companyPhone,
      company_website: companyWebsite,
      company_logo_url: companyLogoUrl,
      
      // Invoice info
      invoice_number: invoice.invoice_number,
      invoice_date: invoiceDate,
      due_date: dueDate,
      
      // Client info
      client_name: project.client_name || project.owner_name || 'Client',
      client_address: project.project_address || 'N/A',
      project_name: project.title || 'Project',
      
      // Invoice items with % billed
      items: invoiceItems,
      total_amount: invoice.total_amount || 0,
      
      // Payment instructions
      bank_account: bankAccount,
      bank_routing: bankRouting,
      bank_name: bankName,
      payment_instructions: paymentInstructions,
      make_checks_payable_to: companyName
    })

    // Generate PDF using Playwright
    const browser = await chromium.launch()
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle' })
    const pdf = await page.pdf({ 
      format: 'Letter', 
      printBackground: true,
      margin: { top: '40px', right: '50px', bottom: '40px', left: '50px' }
    })
    await browser.close()

    // Convert Buffer -> ArrayBuffer for NextResponse BodyInit
    const pdfArrayBuffer = pdf instanceof Buffer ? pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) : pdf

    return new NextResponse(pdfArrayBuffer as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Invoice-${invoice.invoice_number}.pdf"`
      }
    })
  } catch (error) {
    console.error('Error generating invoice PDF:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate PDF' },
      { status: 500 }
    )
  }
}


