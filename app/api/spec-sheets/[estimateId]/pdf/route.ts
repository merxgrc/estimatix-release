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
 * Format a spec sheet bullet point with quantity information.
 * 
 * @param item - Item object with description, quantity, and optional unit info
 * @param originalItem - Optional original line item with full details (qty, unit_cost, etc.)
 * @returns Formatted bullet text with quantity embedded
 */
function formatSpecSheetBullet(item: any, originalItem?: any): string {
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

  // Group atomic line items by cost_code (trade) then by room_name
  const itemsByCostCode = new Map<string, Map<string, any[]>>();
  
  jsonData.items.forEach((item: any) => {
    const costCode = item.cost_code || getCostCodeForItem(item) || '999';
    const roomName = item.room_name || item.room || 'General';
    
    if (!itemsByCostCode.has(costCode)) {
      itemsByCostCode.set(costCode, new Map());
    }
    
    const roomsMap = itemsByCostCode.get(costCode)!;
    if (!roomsMap.has(roomName)) {
      roomsMap.set(roomName, []);
    }
    
    roomsMap.get(roomName)!.push(item);
  });

  // Get trade title mapping
  const tradeTitleMap: Record<string, string> = {
    '201': 'DEMO',
    '305': 'FRAMING',
    '402': 'HVAC',
    '404': 'PLUMBING',
    '405': 'ELECTRICAL',
    '520': 'WINDOWS',
    '530': 'DOORS',
    '640': 'CABINETS',
    '641': 'COUNTERTOPS',
    '950': 'TILE',
    '960': 'FLOORING',
    '990': 'PAINT',
    '999': 'OTHER'
  };

  // Convert grouped items into sections
  const sections: any[] = [];

  itemsByCostCode.forEach((roomsMap, costCode) => {
    // Build section items grouped by room
    const sectionItems: any[] = [];
    
    // Sort rooms for consistent ordering
    const sortedRooms = Array.from(roomsMap.keys()).sort();
    
    sortedRooms.forEach(roomName => {
      const roomItems = roomsMap.get(roomName)!;
      
      // Each room becomes an item with subitems (atomic tasks)
      sectionItems.push({
        text: roomName,
        label: roomName,
        subitems: roomItems.map((item: any) => item.description || '').filter((desc: string) => desc.trim().length > 0)
      });
    });

    // Calculate allowance if this section is allowance-eligible
    let allowance: number | null = null;
    if (isAllowanceCostCode(costCode)) {
      // Sum all client_price values for this section (if available)
      const sectionTotal = Array.from(roomsMap.values())
        .flat()
        .reduce((sum: number, item: any) => {
          return sum + (item.client_price || item.total || 0);
        }, 0);
      allowance = sectionTotal > 0 ? sectionTotal : null;
    }

    sections.push({
      code: costCode,
      title: tradeTitleMap[costCode] || 'OTHER',
      allowance: allowance,
      items: sectionItems
    });
  });

  // Sort sections by cost code
  sections.sort((a, b) => a.code.localeCompare(b.code));

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
    let allItems = jsonData?.items || [];

    // Try to fetch line items from estimate_line_items table (authoritative source)
    const { data: lineItemsData } = await supabase
      .from('estimate_line_items')
      .select('*')
      .eq('estimate_id', estimateId)
      .order('created_at', { ascending: true });

    if (lineItemsData && lineItemsData.length > 0) {
      // Use line items from database (more accurate)
      allItems = lineItemsData.map(item => ({
        category: item.category || 'Other',
        description: item.description || '',
        cost_code: item.cost_code || '999',
        room_name: item.room_name || 'General',
        labor_cost: item.labor_cost || null,
        margin_percent: item.margin_percent || null,
        client_price: item.client_price || null
      }));
      console.log('[PDF] Using estimate_line_items from database:', allItems.length, 'items');
    }

    // Use spec_sections from database, or fallback to transformed json_data
    let sections: any[] = [];
    
    if (estimate.spec_sections && Array.isArray(estimate.spec_sections)) {
      // Use structured spec sections from AI parsing
      sections = estimate.spec_sections;
      console.log('[PDF] Using spec_sections from database:', JSON.stringify(sections, null, 2));
      
      // Enhance sections with allowance calculations
      sections = sections.map(section => {
        const costCode = section.code || '';
        const shouldShowAllowance = isAllowanceCostCode(costCode);
        
        // Find matching items for this section to calculate allowance
        const matchingItems = allItems.filter((item: any) => {
          const itemCostCode = item.cost_code || getCostCodeForItem(item);
          return itemCostCode === costCode;
        });
        
        if (shouldShowAllowance) {
          // If allowance is not explicitly set, calculate it from matching items
          if (section.allowance === null || section.allowance === undefined) {
            const calculatedTotal = matchingItems.reduce((sum: number, item: any) => {
              return sum + (item.client_price || item.total || 0);
            }, 0);
            
            if (calculatedTotal > 0) {
              section.allowance = calculatedTotal;
            }
          }
        } else {
          // Not allowance-eligible, ensure allowance is null
          section.allowance = null;
        }
        
        // Note: With atomic line items, section.items already contain room groupings with subitems
        // No need to enhance with quantities since each subitem is already an atomic task description
        // The AI parser creates spec_sections with proper room → subitems structure
        
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

    const template = loadTemplate("estimatix-spec-sheet.html");
    const html = renderTemplate(template, {
      owner_name: project?.owner_name || estimate.client_name || 'N/A',
      project_address: project?.project_address || estimate.project_address || 'N/A',
      project_name: project?.title || estimate.project_name || 'Project Estimate',
      spec_sheet_date: new Date().toLocaleDateString(),
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

    const fileName = `spec-sheet-${estimateId}-${Date.now()}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("spec-sheets")
      .upload(fileName, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: { publicUrl } } = supabase.storage.from("spec-sheets").getPublicUrl(fileName);

    const { error: updateError } = await supabase
      .from("estimates")
      .update({ spec_sheet_url: publicUrl })
      .eq("id", estimateId);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error("[spec-sheet-pdf] error", err);
    return NextResponse.json(
      { error: "Failed to generate spec sheet PDF" },
      { status: 500 },
    );
  }
}

