import { NextResponse } from "next/server";
import { chromium } from "playwright";

import { loadTemplate } from "@/lib/loadTemplate";
import { renderTemplate } from "@/lib/renderTemplate";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAllowanceCostCode, getCostCodeForItem } from "@/lib/allowanceRules";
import { getProfileByUserId } from "@/lib/profile";

export const runtime = "nodejs";

/**
 * Pluralize a noun based on quantity.
 * 
 * @param noun - The noun to pluralize
 * @param qty - The quantity
 * @returns Pluralized noun if qty > 1, otherwise singular
 */
function pluralizeNoun(noun: string, qty: number): string {
  if (qty === 1) return noun;
  
  const nounLower = noun.toLowerCase();
  
  // Common pluralization rules
  const pluralRules: Record<string, string> = {
    'window': 'windows',
    'door': 'doors',
    'cabinet': 'cabinets',
    'fixture': 'fixtures',
    'outlet': 'outlets',
    'switch': 'switches',
    'light': 'lights',
    'fan': 'fans',
    'appliance': 'appliances',
    'countertop': 'countertops',
    'sink': 'sinks',
    'faucet': 'faucets',
    'toilet': 'toilets',
    'shower': 'showers',
    'bathtub': 'bathtubs',
    'mirror': 'mirrors',
    'tile': 'tiles',
    'board': 'boards',
    'panel': 'panels',
    'unit': 'units',
    'item': 'items',
    'piece': 'pieces',
  };
  
  // Check if we have a direct mapping
  if (pluralRules[nounLower]) {
    // Preserve original case
    if (noun[0] === noun[0].toUpperCase()) {
      return pluralRules[nounLower].charAt(0).toUpperCase() + pluralRules[nounLower].slice(1);
    }
    return pluralRules[nounLower];
  }
  
  // Default pluralization rules
  if (nounLower.endsWith('y') && !['ay', 'ey', 'iy', 'oy', 'uy'].some(ending => nounLower.endsWith(ending))) {
    return noun.slice(0, -1) + 'ies';
  } else if (nounLower.endsWith('s') || nounLower.endsWith('sh') || nounLower.endsWith('ch') || 
             nounLower.endsWith('x') || nounLower.endsWith('z')) {
    return noun + 'es';
  } else if (nounLower.endsWith('f')) {
    return noun.slice(0, -1) + 'ves';
  } else if (nounLower.endsWith('fe')) {
    return noun.slice(0, -2) + 'ves';
  } else {
    return noun + 's';
  }
}

/**
 * Format a proposal bullet point with quantity information.
 * 
 * @param item - Item object with description, quantity, and optional unit info
 * @param originalItem - Optional original line item with full details (qty, unit_cost, etc.)
 * @returns Formatted bullet text with quantity embedded
 */
function formatProposalBullet(item: any, originalItem?: any): string {
  const description = item.text || item.description || '';
  if (!description) return '';
  
  // Get quantity from originalItem if available, otherwise from item
  const qty = originalItem?.quantity || originalItem?.qty || item.quantity || item.qty;
  
  // If no quantity or quantity is 0 or invalid, return description as-is
  if (!qty || qty === 0 || typeof qty !== 'number') {
    return description;
  }
  
  // Check if description already contains a number/quantity to avoid double-counting
  const hasNumberInDescription = /\d+/.test(description);
  if (hasNumberInDescription) {
    // Check if it's a quantity-like pattern (e.g., "7 windows", "120 sq ft")
    const quantityPattern = /^(\d+)\s*(x|×)?\s*/i;
    if (quantityPattern.test(description)) {
      // Already has quantity prefix, return as-is
      return description;
    }
  }
  
  // Format quantity based on type
  let quantityText = '';
  
  // Check if this is a square footage or area measurement
  const descLower = description.toLowerCase();
  if (descLower.includes('sq ft') || descLower.includes('square feet') || 
      descLower.includes('sq.ft') || descLower.includes('sqft')) {
    quantityText = `<strong>${qty} sq ft</strong>`;
  } else if (descLower.includes('sq yd') || descLower.includes('square yard')) {
    quantityText = `<strong>${qty} sq yd</strong>`;
  } else if (descLower.includes('linear ft') || descLower.includes('lf') || descLower.includes('lin ft')) {
    quantityText = `<strong>${qty} linear ft</strong>`;
  } else {
    // Regular count quantity
    quantityText = `<strong>${qty}</strong>`;
  }
  
  // Apply pluralization to the description if qty > 1
  let processedDescription = description;
  if (qty > 1) {
    // Try to find and pluralize common nouns after verbs
    const verbPattern = /^(Replace|Install|Remove|Demo|Add|Upgrade|Refinish|Paint|Reface|Haul|Dispose|Disconnect|Connect|Wire|Plumb|Frame|Drywall|Tile|Floor|Cabinet)\s+(\w+)/i;
    const match = processedDescription.match(verbPattern);
    
    if (match) {
      const verb = match[1];
      const noun = match[2];
      const rest = processedDescription.substring(match[0].length);
      const pluralizedNoun = pluralizeNoun(noun, qty);
      processedDescription = `${verb} ${pluralizedNoun}${rest}`;
    } else {
      // Try to find nouns at the start or after common patterns
      const nounPattern = /\b(window|door|cabinet|fixture|outlet|switch|light|fan|appliance|countertop|sink|faucet|toilet|shower|bathtub|mirror|tile|board|panel|unit|item|piece)\b/gi;
      processedDescription = processedDescription.replace(nounPattern, (match: string) => {
        return pluralizeNoun(match, qty);
      });
    }
  }
  
  // Insert quantity into description
  // Try to find a good insertion point (after verbs like "Replace", "Install", "Remove", etc.)
  const verbPattern = /^(Replace|Install|Remove|Demo|Add|Upgrade|Refinish|Paint|Reface|Haul|Dispose|Disconnect|Connect|Wire|Plumb|Frame|Drywall|Tile|Floor|Cabinet)\s+/i;
  const match = processedDescription.match(verbPattern);
  
  if (match) {
    // Insert after verb
    const verb = match[0].trim();
    const rest = processedDescription.substring(match[0].length).trim();
    return `${verb} ${quantityText} ${rest}`;
  } else {
    // Insert at the beginning
    return `${quantityText} ${processedDescription}`;
  }
}

// Transform line items from json_data into sections format for the template
function transformItemsToSections(jsonData: any): any[] {
  if (!jsonData?.items || !Array.isArray(jsonData.items)) {
    return [];
  }

  // Group items by category, preserving cost code information
  const itemsByCategory = new Map<string, { items: any[], costCode?: string }>();
  
  jsonData.items.forEach((item: any) => {
    const category = item.category || 'Other';
    const costCode = getCostCodeForItem(item);
    
    if (!itemsByCategory.has(category)) {
      itemsByCategory.set(category, { items: [], costCode });
    }
    itemsByCategory.get(category)!.items.push(item);
    // Use the first cost code found for this category
    if (costCode && !itemsByCategory.get(category)!.costCode) {
      itemsByCategory.get(category)!.costCode = costCode;
    }
  });

  // Convert each category group into a section
  const sections: any[] = [];
  let sectionCode = 100;

  itemsByCategory.forEach(({ items, costCode }, category) => {
    const sectionItems = items.map((item: any) => {
      // Format description with quantity using the helper function
      let desc = formatProposalBullet({ description: item.description }, item);
      
      // Add dimensions if present (but don't duplicate quantity info)
      if (item.dimensions) {
        const dims = item.dimensions;
        const dimStr = dims.depth 
          ? `${dims.width}×${dims.height}×${dims.depth} ${dims.unit}`
          : `${dims.width}×${dims.height} ${dims.unit}`;
        desc = `${desc} (${dimStr})`;
      }
      
      // Note: Removed unit_cost and total from description as they're not needed in proposal bullets
      // The allowance is shown in the section header instead

      return {
        text: desc,
        ...(item.notes ? { subitems: [item.notes] } : {})
      };
    });

    // Calculate allowance if this section is allowance-eligible
    let allowance: number | null = null;
    if (costCode && isAllowanceCostCode(costCode)) {
      // Sum all item totals for this section
      const sectionTotal = items.reduce((sum, item) => {
        return sum + (item.total || 0);
      }, 0);
      allowance = sectionTotal > 0 ? sectionTotal : null;
    }

    sections.push({
      code: costCode || sectionCode.toString(),
      title: category.toUpperCase(),
      allowance: allowance,
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
      
      // Get section title to filter out from item text/labels (to avoid repeating "DEMO", etc.)
      const sectionTitle = (section.title || '').trim().toUpperCase();

      // Handle text - include if it has a value (can be null for label-only items)
      if (item.text !== null && item.text !== undefined) {
        let textStr = String(item.text).trim();
        // Skip if text exactly matches section title (already shown in header)
        if (sectionTitle && textStr.toUpperCase() === sectionTitle) {
          // Don't set normalized.text if it's just the section title
        } else {
          // Remove section title from text if it appears as prefix/suffix (e.g., "DEMO Kitchen" -> "Kitchen")
          if (sectionTitle && textStr.toUpperCase().includes(sectionTitle)) {
            textStr = textStr.replace(new RegExp(`^${sectionTitle}\\s+`, 'i'), '').trim();
            textStr = textStr.replace(new RegExp(`\\s+${sectionTitle}$`, 'i'), '').trim();
            textStr = textStr.replace(new RegExp(`\\s+${sectionTitle}\\s+`, 'i'), ' ').trim();
          }
          if (textStr) {
            normalized.text = textStr;
          }
        }
      }

      // Handle label - include if it has a value
      if (item.label !== null && item.label !== undefined) {
        let labelStr = String(item.label).trim();
        // Skip if label exactly matches section title (already shown in header)
        if (sectionTitle && labelStr.toUpperCase() === sectionTitle) {
          // Don't set normalized.label if it's just the section title
        } else {
          // Remove section title from label if it appears as prefix/suffix
          if (sectionTitle && labelStr.toUpperCase().includes(sectionTitle)) {
            labelStr = labelStr.replace(new RegExp(`^${sectionTitle}\\s+`, 'i'), '').trim();
            labelStr = labelStr.replace(new RegExp(`\\s+${sectionTitle}$`, 'i'), '').trim();
            labelStr = labelStr.replace(new RegExp(`\\s+${sectionTitle}\\s+`, 'i'), ' ').trim();
          }
          if (labelStr) {
            normalized.label = labelStr;
          }
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
        return false;
      }
      
      // Filter out items where text/label exactly matches section title (already in header)
      const sectionTitle = (section.title || '').trim().toUpperCase();
      if (sectionTitle) {
        const textMatches = item.text && item.text.trim().toUpperCase() === sectionTitle;
        const labelMatches = item.label && item.label.trim().toUpperCase() === sectionTitle;
        // If only content is the section title and no subitems, skip it
        if ((textMatches || labelMatches) && (!item.subitems || item.subitems.length === 0)) {
          console.log(`[PDF] Filtering out item ${index} in section ${section.code} - matches section title "${sectionTitle}"`);
          return false;
        }
      }
      
      return true;
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
    let allowanceValue: number | null = null;
    
    // Check if this section should have an allowance based on cost code
    const sectionCostCode = section.code || '';
    const shouldShowAllowance = isAllowanceCostCode(sectionCostCode);
    
    if (shouldShowAllowance) {
      // If allowance is explicitly set, use it
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
      // Note: Allowance calculation from items is done before normalization
      // in the main GET handler, so we don't need to recalculate here
    }
    // If not allowance-eligible, leave allowanceValue as null (will not display)

    return {
      code: section.code || '',
      title: section.title || '',
      allowance: allowanceValue, // Only set if cost code is allowance-eligible
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
    // Fetch estimate with project data
    const { data: estimate, error: estimateError } = await supabase
      .from("estimates")
      .select(`
        *,
        projects (
          id,
          title,
          owner_name,
          project_address,
          client_name,
          user_id
        )
      `)
      .eq("id", estimateId)
      .single();

    if (estimateError) {
      return NextResponse.json({ error: estimateError.message }, { status: 500 });
    }

    if (!estimate) {
      return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    }

    // Extract project data (Supabase returns it as an array for foreign key relationships)
    const project = Array.isArray(estimate.projects) ? estimate.projects[0] : estimate.projects;

    // Fetch estimator profile
    let estimatorProfile = null
    if (project?.user_id) {
      try {
        estimatorProfile = await getProfileByUserId(project.user_id)
      } catch (err) {
        console.warn('Could not load estimator profile:', err)
      }
    }

    const jsonData = estimate.json_data as any;
    const allItems = jsonData?.items || [];

    // Use spec_sections from database, or fallback to transformed json_data
    let sections: any[] = [];
    
    if (estimate.spec_sections && Array.isArray(estimate.spec_sections)) {
      // Use structured spec sections from AI parsing
      sections = estimate.spec_sections;
      console.log('[PDF] Using spec_sections from database:', JSON.stringify(sections, null, 2));
      
      // Enhance sections with allowance calculations and quantity formatting
      sections = sections.map(section => {
        const costCode = section.code || '';
        const shouldShowAllowance = isAllowanceCostCode(costCode);
        
        // Find matching items for this section to get quantities
        const matchingItems = allItems.filter((item: any) => {
          const itemCostCode = getCostCodeForItem(item);
          const sectionTitleUpper = (section.title || '').toUpperCase();
          const itemCategoryUpper = (item.category || '').toUpperCase();
          
          return itemCostCode === costCode || 
                 itemCategoryUpper === sectionTitleUpper ||
                 (sectionTitleUpper.includes(itemCategoryUpper) || itemCategoryUpper.includes(sectionTitleUpper));
        });
        
        if (shouldShowAllowance) {
          // If allowance is not explicitly set, calculate it from matching items
          if (section.allowance === null || section.allowance === undefined) {
            const calculatedTotal = matchingItems.reduce((sum: number, item: any) => {
              return sum + (item.total || 0);
            }, 0);
            
            if (calculatedTotal > 0) {
              section.allowance = calculatedTotal;
            }
          }
        } else {
          // Not allowance-eligible, ensure allowance is null
          section.allowance = null;
        }
        
        // Enhance section items with quantities from matching line items
        if (section.items && Array.isArray(section.items)) {
          section.items = section.items.map((item: any) => {
            const itemText = (item.text || '').toLowerCase();
            
            // Skip if text already contains formatted quantity (has <strong> tags)
            if (itemText.includes('<strong>')) {
              return item;
            }
            
            // Skip if text already starts with a number pattern (e.g., "7x", "120 sq ft")
            if (/^(\d+)\s*(x|×|sq\s*ft|sq\s*yd|linear\s*ft)/i.test(itemText)) {
              return item;
            }
            
            // Try to find a matching original item for this proposal item
            let matchingItem: any = null;
            if (matchingItems.length > 0) {
              matchingItem = matchingItems.find((origItem: any) => {
                const origDesc = (origItem.description || '').toLowerCase();
                // Check if descriptions are similar (contain common words)
                const itemWords = itemText.split(/\s+/).filter((w: string) => w.length > 3);
                const origWords = origDesc.split(/\s+/).filter((w: string) => w.length > 3);
                const commonWords = itemWords.filter((w: string) => origWords.includes(w));
                return commonWords.length > 0 || itemText.includes(origDesc) || origDesc.includes(itemText);
              });
            }
            
            // Format the text with quantity if we found a match
            if (matchingItem && item.text) {
              const formattedText = formatProposalBullet({ text: item.text }, matchingItem);
              return {
                ...item,
                text: formattedText
              };
            }
            
            // If no match but item has quantity info, use it
            if (item.quantity || item.qty) {
              const formattedText = formatProposalBullet(item, item);
              return {
                ...item,
                text: formattedText
              };
            }
            
            // No quantity available, return as-is
            return item;
          });
        }
        
        return section;
      });
    } else {
      // Fallback: transform json_data.items into sections format
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
      owner_name: project?.owner_name || estimate.client_name || 'N/A',
      project_address: project?.project_address || estimate.project_address || 'N/A',
      project_name: project?.title || estimate.project_name || 'Project Estimate',
      proposal_date: new Date().toLocaleDateString(),
      year: new Date().getFullYear(),
      sections: sections,
      estimator_name: estimatorProfile?.full_name || null,
      estimator_company: estimatorProfile?.company_name || null,
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

    const { data: { publicUrl } } = supabase.storage.from("proposals").getPublicUrl(fileName);

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

