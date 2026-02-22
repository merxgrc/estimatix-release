import { NextResponse } from "next/server"
import { launchBrowser } from "@/lib/pdf-browser"
import { loadTemplate } from "@/lib/loadTemplate"
import { renderTemplate } from "@/lib/renderTemplate"
import { createServerClient, requireAuth } from "@/lib/supabase/server"
import { getProfileByUserId } from "@/lib/profile"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: proposalId } = await context.params

    if (!proposalId) {
      return NextResponse.json(
        { error: "Missing proposal ID" },
        { status: 400 }
      )
    }

    // Authenticate user
    const user = await requireAuth()
    if (!user || !user.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const supabase = await createServerClient()

    // Fetch proposal record
    const { data: proposal, error: proposalError } = await supabase
      .from("proposals")
      .select("*")
      .eq("id", proposalId)
      .maybeSingle()

    if (proposalError) {
      console.error("Error fetching proposal:", proposalError)
      return NextResponse.json(
        { error: `Failed to fetch proposal: ${proposalError.message}` },
        { status: 500 }
      )
    }

    if (!proposal) {
      return NextResponse.json(
        { error: "Proposal not found" },
        { status: 404 }
      )
    }

    // Verify ownership through project
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", proposal.project_id)
      .maybeSingle()

    if (projectError) {
      console.error("Error fetching project:", projectError)
      return NextResponse.json(
        { error: `Failed to fetch project: ${projectError.message}` },
        { status: 500 }
      )
    }

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      )
    }

    if (project.user_id !== user.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      )
    }

    // Fetch profile for contractor info and logo
    let contractorProfile = null
    if (proposal.created_by) {
      try {
        contractorProfile = await getProfileByUserId(proposal.created_by)
      } catch (profileError) {
        console.warn("Failed to fetch contractor profile:", profileError)
      }
    }

    // If no created_by, try to get profile from project owner
    if (!contractorProfile && project.user_id) {
      try {
        contractorProfile = await getProfileByUserId(project.user_id)
      } catch (profileError) {
        console.warn("Failed to fetch project owner profile:", profileError)
      }
    }

    // Parse body_json
    const bodyJson = proposal.body_json as {
      allowances?: Array<{
        description: string
        cost_code: string | null
        amount: number
      }>
      inclusions?: string[]
      exclusions?: string[]
      basis_of_estimate?: string
      notes?: string
    } || {}

    // Fetch ALL line items from the estimate and separate allowances from scope work
    // Only include items from active/included rooms
    let allowanceItems: Array<{ description: string; client_price: number }> = []
    let scopeItems: Array<{ description: string; client_price: number }> = []
    let totalAllowances = 0
    
    if (proposal.estimate_id) {
      // Join with rooms to filter out excluded rooms (is_in_scope = false)
      let lineItemsData: any[] | null = null
      const { data: liData, error: lineItemsError } = await supabase
        .from('estimate_line_items')
        .select(`
          description, 
          client_price, 
          is_allowance,
          room_id,
          rooms!estimate_line_items_room_id_fkey (
            id,
            is_in_scope
          )
        `)
        .eq('estimate_id', proposal.estimate_id)
        .order('created_at', { ascending: true })

      if (lineItemsError?.message?.includes('column') || lineItemsError?.message?.includes('schema cache')) {
        // is_in_scope missing — fetch without join (treat all as in-scope)
        const { data: fallbackItems } = await supabase
          .from('estimate_line_items')
          .select('description, client_price, is_allowance, room_id')
          .eq('estimate_id', proposal.estimate_id)
          .order('created_at', { ascending: true })
        lineItemsData = fallbackItems
      } else {
        lineItemsData = liData
      }

      if (!lineItemsError && lineItemsData && lineItemsData.length > 0) {
        lineItemsData.forEach((item: any) => {
          const desc = item.description || ''
          if (desc.trim().length === 0) return
          
          // Filter out items from excluded (out-of-scope) rooms
          // Items without a room (room_id = null) are included by default
          const room = item.rooms as { id: string; is_in_scope: boolean } | null
          if (room && room.is_in_scope === false) {
            return // Skip excluded room items
          }
          
          const isAllowance = item.is_allowance === true || 
                             (desc.toUpperCase().trim().startsWith('ALLOWANCE:'))
          const price = item.client_price || 0
          
          const itemObj = {
            description: desc.trim(),
            client_price: price
          }
          
          if (isAllowance) {
            allowanceItems.push(itemObj)
            totalAllowances += price
          } else {
            scopeItems.push(itemObj)
          }
        })
        
        // Sort both arrays alphabetically
        allowanceItems.sort((a, b) => a.description.localeCompare(b.description))
        scopeItems.sort((a, b) => a.description.localeCompare(b.description))
      }
    }

    // Get company logo URL
    const companyLogoUrl = 
      (contractorProfile as any)?.company_logo_url || 
      (contractorProfile as any)?.logo_url || 
      null

    // Extract footer info from profile
    const profileAny = contractorProfile as any
    const contractorAddress = profileAny?.address || profileAny?.company_address || null
    const contractorWebsite = profileAny?.website || profileAny?.company_website || null
    const contractorLicense = profileAny?.license_number || profileAny?.license || null

    // Format proposal date
    const proposalDate = proposal.created_at
      ? new Date(proposal.created_at).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })
      : new Date().toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })

    // Load and render template
    let template: string
    try {
      template = loadTemplate("proposal.html")
    } catch (templateError) {
      console.error("Error loading template:", templateError)
      return NextResponse.json(
        { 
          error: "Failed to load PDF template",
          details: templateError instanceof Error ? templateError.message : "Unknown error"
        },
        { status: 500 }
      )
    }

    let html: string
    try {
      html = renderTemplate(template, {
      proposal_title: proposal.title || "Construction Proposal",
      proposal_date: proposalDate,
      proposal_version: proposal.version || 1,
      total_price: proposal.total_price || 0,
      year: new Date().getFullYear(),
      
      // Client info
      client_name: project.client_name || project.owner_name || "Client",
      project_address: project.project_address || "N/A",
      project_name: project.title || "Project",
      
      // Contractor info
      contractor_name: contractorProfile?.full_name || null,
      contractor_company: contractorProfile?.company_name || null,
      contractor_phone: contractorProfile?.phone || null,
      contractor_address: contractorAddress,
      contractor_website: contractorWebsite,
      contractor_license: contractorLicense,
      company_logo_url: companyLogoUrl,
      
      // Proposal content
      basis_of_estimate: bodyJson.basis_of_estimate || "",
      allowance_items: allowanceItems, // Items where is_allowance === true
      scope_items: scopeItems, // Items where is_allowance === false (the "real" work)
      total_allowances: totalAllowances,
      custom_inclusions: bodyJson.inclusions || [], // User-provided custom inclusions (if any)
      exclusions: bodyJson.exclusions || [],
      discussions: bodyJson.notes || "", // Store discussions in notes field
      })
    } catch (renderError) {
      console.error("Error rendering template:", renderError)
      return NextResponse.json(
        { 
          error: "Failed to render PDF template",
          details: renderError instanceof Error ? renderError.message : "Unknown error"
        },
        { status: 500 }
      )
    }

    // Generate PDF using Playwright-core + @sparticuz/chromium
    let browser
    try {
      browser = await launchBrowser()
      const page = await browser.newPage()

      await page.setContent(html, { waitUntil: "networkidle" })

      const pdf = await page.pdf({
        format: "Letter",
        printBackground: true,
        margin: { top: "40px", right: "50px", bottom: "60px", left: "50px" },
      })

      await browser.close()
      
      // Return PDF as blob
      const pdfArrayBuffer = pdf instanceof Buffer ? pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) : pdf

      return new NextResponse(pdfArrayBuffer as BodyInit, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="Proposal-${proposal.title || 'Proposal'}-v${proposal.version}-${Date.now()}.pdf"`,
        },
      })
    } catch (pdfError) {
      console.error("Error generating PDF with Playwright:", pdfError)
      if (browser) {
        try {
          await browser.close()
        } catch (closeError) {
          console.error("Error closing browser:", closeError)
        }
      }
      return NextResponse.json(
        { 
          error: "Failed to generate PDF",
          details: pdfError instanceof Error ? pdfError.message : "Unknown error"
        },
        { status: 500 }
      )
    }

  } catch (error) {
    console.error("Error generating proposal PDF:", error)
    return NextResponse.json(
      { 
        error: "Failed to generate PDF",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    )
  }
}

