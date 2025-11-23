import { NextResponse } from "next/server";
import { chromium } from "playwright";

import { loadTemplate } from "@/lib/loadTemplate";
import { renderTemplate } from "@/lib/renderTemplate";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Transform line items from json_data into sections format for the template
function transformItemsToSections(jsonData: any): any[] {
  if (!jsonData?.items || !Array.isArray(jsonData.items)) {
    return [];
  }

  // Group items by category
  const itemsByCategory = new Map<string, any[]>();
  
  jsonData.items.forEach((item: any) => {
    const category = item.category || 'Other';
    if (!itemsByCategory.has(category)) {
      itemsByCategory.set(category, []);
    }
    itemsByCategory.get(category)!.push(item);
  });

  // Convert each category group into a section
  const sections: any[] = [];
  let sectionCode = 100;

  itemsByCategory.forEach((items, category) => {
    const sectionItems = items.map((item: any) => {
      const parts: string[] = [];
      
      // Build description with quantity and dimensions
      let desc = item.description || '';
      if (item.quantity && item.quantity > 1) {
        desc = `${item.quantity}x ${desc}`;
      }
      
      if (item.dimensions) {
        const dims = item.dimensions;
        const dimStr = dims.depth 
          ? `${dims.width}×${dims.height}×${dims.depth} ${dims.unit}`
          : `${dims.width}×${dims.height} ${dims.unit}`;
        desc = `${desc} (${dimStr})`;
      }
      
      if (item.unit_cost) {
        desc = `${desc} - $${item.unit_cost.toLocaleString()}${item.total ? ` (Total: $${item.total.toLocaleString()})` : ''}`;
      }

      return {
        text: desc,
        ...(item.notes ? { subitems: [item.notes] } : {})
      };
    });

    sections.push({
      code: sectionCode.toString(),
      title: category.toUpperCase(),
      items: sectionItems
    });

    sectionCode += 10;
  });

  return sections;
}

// Normalize sections to ensure proper Handlebars rendering
function normalizeSectionsForTemplate(sections: any[]): any[] {
  return sections.map(section => {
    // Ensure items is always an array
    if (!Array.isArray(section.items)) {
      section.items = [];
    }

    // Normalize each item for Handlebars
    const normalizedItems = section.items.map((item: any, index: number) => {
      const normalized: any = {};

      // Handle text - include if it has a value (can be null for label-only items)
      if (item.text !== null && item.text !== undefined) {
        const textStr = String(item.text).trim();
        if (textStr) {
          normalized.text = textStr;
        }
      }

      // Handle label - include if it has a value
      if (item.label !== null && item.label !== undefined) {
        const labelStr = String(item.label).trim();
        if (labelStr) {
          normalized.label = labelStr;
        }
      }

      // Handle subitems - ensure it's always an array (even if empty)
      normalized.subitems = [];
      if (item.subitems !== null && item.subitems !== undefined) {
        if (Array.isArray(item.subitems)) {
          normalized.subitems = item.subitems
            .map((sub: any) => String(sub).trim())
            .filter((sub: string) => sub.length > 0);
        } else if (typeof item.subitems === 'string' && item.subitems.trim()) {
          normalized.subitems = [item.subitems.trim()];
        }
      }
      // Always include subitems array, even if empty (for Handlebars)

      // If both text and label are missing, try to use description or other fields
      if (!normalized.text && !normalized.label) {
        if (item.description && typeof item.description === 'string' && item.description.trim()) {
          normalized.text = item.description.trim();
        } else if (typeof item === 'string') {
          // If the item itself is a string, use it as text
          normalized.text = String(item).trim();
        }
      }

      // Debug log for each item
      console.log(`[PDF] Normalizing item ${index} in section ${section.code}:`, {
        original: item,
        normalized: normalized
      });

      return normalized;
    }).filter((item: any, index: number) => {
      // Keep items that have at least text, label, or subitems
      const hasContent = (item.text && item.text.trim()) || 
                        (item.label && item.label.trim()) || 
                        (item.subitems && item.subitems.length > 0);
      
      if (!hasContent) {
        console.log(`[PDF] Filtering out empty item ${index} in section ${section.code}`);
      }
      
      return hasContent;
    });

    // Ensure at least one item exists - but log a warning
    if (normalizedItems.length === 0) {
      console.warn(`[PDF] Section ${section.code} ${section.title} has no items after normalization! Original items:`, section.items);
      normalizedItems.push({
        text: `Work items for ${section.title}`,
        subitems: []
      });
    }
    
    console.log(`[PDF] Section ${section.code} ${section.title}: ${normalizedItems.length} normalized items`);

    // Format allowance for display (convert number to formatted string if needed)
    let allowanceValue = null;
    if (section.allowance !== null && section.allowance !== undefined) {
      if (typeof section.allowance === 'number') {
        allowanceValue = section.allowance;
      } else if (typeof section.allowance === 'string') {
        // Try to parse string allowance
        const cleaned = section.allowance.replace(/[$,\s]/g, '');
        const parsed = parseFloat(cleaned);
        allowanceValue = isNaN(parsed) ? null : parsed;
      }
    }

    return {
      code: section.code || '',
      title: section.title || '',
      allowance: allowanceValue,
      items: normalizedItems,
      subcontractor: section.subcontractor || null,
      notes: section.notes || null
    };
  }).filter(section => {
    // Remove sections with no items
    return section.items && section.items.length > 0;
  });
}

export async function GET(_req: Request, context: { params: Promise<{ estimateId: string }> }) {
  const supabase = createServiceRoleClient();
  const { estimateId } = await context.params;

  try {
    const { data: estimate, error } = await supabase
      .from("estimates")
      .select("*")
      .eq("id", estimateId)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!estimate) {
      return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    }

    // Use spec_sections from database, or fallback to transformed json_data
    let sections: any[] = [];
    
    if (estimate.spec_sections && Array.isArray(estimate.spec_sections)) {
      // Use structured spec sections from AI parsing
      sections = estimate.spec_sections;
      console.log('[PDF] Using spec_sections from database:', JSON.stringify(sections, null, 2));
    } else {
      // Fallback: transform json_data.items into sections format
      const jsonData = estimate.json_data as any;
      sections = transformItemsToSections(jsonData);
      console.log('[PDF] Using transformed json_data:', JSON.stringify(sections, null, 2));
    }

    // Normalize sections to ensure proper Handlebars rendering
    sections = normalizeSectionsForTemplate(sections);
    console.log('[PDF] Normalized sections for template:', JSON.stringify(sections, null, 2));
    
    // Detailed log of first section's items structure
    if (sections.length > 0 && sections[0].items) {
      console.log('[PDF] First section items structure:', JSON.stringify(sections[0].items, null, 2));
      console.log('[PDF] First section items count:', sections[0].items.length);
    }

    const template = loadTemplate("estimatix-spec-proposal.html");
    const html = renderTemplate(template, {
      owner_name: estimate.client_name || 'N/A',
      project_address: estimate.project_address || 'N/A',
      project_name: estimate.project_name || 'Project Estimate',
      proposal_date: new Date().toLocaleDateString(),
      year: new Date().getFullYear(),
      sections: sections,
    });
    
    console.log('[PDF] Rendered HTML length:', html.length);
    console.log('[PDF] Number of sections:', sections.length);
    sections.forEach((section, idx) => {
      console.log(`[PDF] Section ${idx}: ${section.code} ${section.title} - ${section.items?.length || 0} items`);
    });

    // Debug: Log a sample of the HTML to verify rendering
    const htmlSample = html.substring(0, 2000);
    console.log('[PDF] HTML sample (first 2000 chars):', htmlSample);

    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: "networkidle" });

    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "40px", right: "40px", bottom: "60px", left: "40px" },
    });

    await browser.close();

    const fileName = `proposal-${estimateId}-${Date.now()}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("proposals")
      .upload(fileName, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const {
      data: { publicUrl },
      error: publicUrlError,
    } = supabase.storage.from("proposals").getPublicUrl(fileName);

    if (publicUrlError) {
      return NextResponse.json(
        { error: publicUrlError.message },
        { status: 500 },
      );
    }

    const { error: updateError } = await supabase
      .from("estimates")
      .update({ proposal_url: publicUrl })
      .eq("id", estimateId);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error("[proposal-pdf] error", err);
    return NextResponse.json(
      { error: "Failed to generate proposal PDF" },
      { status: 500 },
    );
  }
}

