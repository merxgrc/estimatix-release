'use server'

import { createServerClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/supabase/server'

export interface InvoiceItemData {
  taskId: string
  amount: number
  description: string
}

export interface CreateInvoiceData {
  issuedDate: string
  dueDate: string
  items: InvoiceItemData[]
}

export async function createInvoice(
  projectId: string,
  data: CreateInvoiceData
) {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Calculate total amount
    const totalAmount = data.items.reduce((sum, item) => sum + item.amount, 0)

    // Generate invoice number using database function (format: INV-XXXX)
    let invoiceNumber: string
    const { data: invoiceNumberData, error: invoiceNumberError } = await supabase
      .rpc('generate_invoice_number')

    if (invoiceNumberError) {
      // Fallback to manual generation if function doesn't exist
      console.warn('Invoice number function not available, using fallback:', invoiceNumberError)
      const today = new Date()
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
      const { count } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', `${today.toISOString().split('T')[0]}T00:00:00Z`)
        .lt('created_at', `${today.toISOString().split('T')[0]}T23:59:59Z`)
      const sequenceNumber = ((count || 0) + 1).toString().padStart(3, '0')
      invoiceNumber = `INV-${dateStr}-${sequenceNumber}`
    } else {
      invoiceNumber = invoiceNumberData as string
    }

    // Check if user profile exists before setting created_by
    let createdBy: string | null = null
    try {
      const { data: userProfile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()
      
      if (!profileError && userProfile && userProfile.id) {
        createdBy = user.id
      }
    } catch (profileCheckError) {
      console.warn('Error checking user profile:', profileCheckError)
      createdBy = null
    }

    // Create invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        project_id: projectId,
        invoice_number: invoiceNumber,
        status: 'draft',
        total_amount: totalAmount,
        issued_date: data.issuedDate,
        due_date: (data.dueDate && typeof data.dueDate === 'string' && data.dueDate.trim() !== '') ? data.dueDate : null,
        created_by: createdBy
      })
      .select()
      .single()

    if (invoiceError) {
      throw new Error(`Failed to create invoice: ${invoiceError.message}`)
    }

    // Create invoice items
    const invoiceItems = data.items.map(item => ({
      invoice_id: invoice.id,
      task_id: item.taskId,
      amount: item.amount,
      description: item.description
    }))

    const { error: itemsError } = await supabase
      .from('invoice_items')
      .insert(invoiceItems)

    if (itemsError) {
      // Try to delete the invoice if items insertion fails
      await supabase.from('invoices').delete().eq('id', invoice.id)
      throw new Error(`Failed to create invoice items: ${itemsError.message}`)
    }

    // Update project_tasks.billed_amount
    for (const item of data.items) {
      const { data: task, error: taskError } = await supabase
        .from('project_tasks')
        .select('billed_amount')
        .eq('id', item.taskId)
        .maybeSingle()

      if (!taskError && task) {
        const newBilledAmount = (Number(task.billed_amount) || 0) + item.amount
        
        await supabase
          .from('project_tasks')
          .update({ billed_amount: newBilledAmount })
          .eq('id', item.taskId)
      }
    }

    return {
      success: true,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number
    }
  } catch (error) {
    console.error('Error creating invoice:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create invoice'
    }
  }
}


