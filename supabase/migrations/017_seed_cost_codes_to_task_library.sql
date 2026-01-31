-- Seed task_library table with master list of cost codes
-- This migration populates the task_library with cost code definitions
-- Safe to run multiple times (uses ON CONFLICT)

-- Note: This creates placeholder entries for cost codes.
-- Actual pricing data (unit_cost_*, labor_hours_per_unit, material_cost_per_unit)
-- should be populated separately or through the pricing engine.
-- Embeddings will be generated later via the /api/pricing/embed-all-tasks endpoint.

-- Ensure task_library table exists (if not already created)
-- If the table doesn't exist, you'll need to create it first with appropriate schema
-- This assumes task_library has at minimum: id, cost_code, description, unit, notes columns

-- Clean up any duplicate cost_code entries first (keep the first one, delete the rest)
-- This ensures we can create a unique constraint
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  -- Delete duplicate cost_code entries, keeping the one with the earliest id (or first created)
  DELETE FROM public.task_library
  WHERE id IN (
    SELECT id
    FROM (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY cost_code ORDER BY id) as row_num
      FROM public.task_library
      WHERE cost_code IS NOT NULL
    ) duplicates
    WHERE row_num > 1
  );
  
  GET DIAGNOSTICS duplicate_count = ROW_COUNT;
  
  -- Only log if duplicates were found
  IF duplicate_count > 0 THEN
    RAISE NOTICE 'Removed % duplicate cost_code entries', duplicate_count;
  END IF;
END $$;

-- Create unique constraint on cost_code if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'task_library_cost_code_unique'
    AND conrelid = 'public.task_library'::regclass
  ) THEN
    ALTER TABLE public.task_library 
    ADD CONSTRAINT task_library_cost_code_unique UNIQUE (cost_code);
  END IF;
END $$;

INSERT INTO public.task_library (
  id,
  cost_code,
  description,
  unit,
  region,
  unit_cost_low,
  unit_cost_mid,
  unit_cost_high,
  labor_hours_per_unit,
  material_cost_per_unit,
  notes,
  embedding
) VALUES
  -- 100 - PRE-CONSTRUCTION
  (gen_random_uuid(), '111', 'Plans & Design Costs', 'JOB', NULL, 5000, 10000, 20000, NULL, NULL, '100 - PRE-CONSTRUCTION', NULL),
  (gen_random_uuid(), '112', 'Engineering Fees', 'JOB', NULL, 3000, 7500, 15000, NULL, NULL, '100 - PRE-CONSTRUCTION', NULL),
  (gen_random_uuid(), '116', 'Building Permits/Fees', 'JOB', NULL, 2000, 5000, 12000, NULL, NULL, '100 - PRE-CONSTRUCTION', NULL),
  (gen_random_uuid(), '117', 'Arborist Fee', 'JOB', NULL, 500, 1500, 3000, NULL, NULL, '100 - PRE-CONSTRUCTION', NULL),
  (gen_random_uuid(), '125', 'Temporary Toilet Facilities', 'EA', NULL, 150, 250, 400, NULL, 50, '100 - PRE-CONSTRUCTION', NULL),
  (gen_random_uuid(), '126', 'Equipment Rental', 'JOB', NULL, 1000, 2500, 5000, NULL, NULL, '100 - PRE-CONSTRUCTION', NULL),
  (gen_random_uuid(), '127', 'Material Protection', 'JOB', NULL, 500, 1500, 3000, NULL, NULL, '100 - PRE-CONSTRUCTION', NULL),
  (gen_random_uuid(), '129', 'Job Supervision', 'JOB', NULL, 5000, 12000, 25000, NULL, NULL, '100 - PRE-CONSTRUCTION', NULL),
  (gen_random_uuid(), '131', 'Trash Removal / Lot Clean-up', 'JOB', NULL, 800, 2000, 4000, NULL, NULL, '100 - PRE-CONSTRUCTION', NULL),
  (gen_random_uuid(), '132', 'Job Superintendent', 'JOB', NULL, 8000, 15000, 30000, NULL, NULL, '100 - PRE-CONSTRUCTION', NULL),
  (gen_random_uuid(), '134', 'Liability Insurance Impact', 'JOB', NULL, 2000, 5000, 10000, NULL, NULL, '100 - PRE-CONSTRUCTION', NULL),
  (gen_random_uuid(), '135', 'Warranty', 'JOB', NULL, 1000, 3000, 6000, NULL, NULL, '100 - PRE-CONSTRUCTION', NULL),
  (gen_random_uuid(), '138', 'In- house Carpentry/ Labor', 'HR', NULL, 45, 65, 85, 1.0, NULL, '100 - PRE-CONSTRUCTION', NULL),
  (gen_random_uuid(), '141', 'Temporary Fencing', 'LF', NULL, 8, 15, 25, 0.1, 5, '100 - PRE-CONSTRUCTION', NULL),

  -- 200 - EXCAVATION & FOUNDATION
  (gen_random_uuid(), '201', 'Site Clearing / Demo', 'JOB', NULL, 3000, 8000, 20000, NULL, NULL, '200 - EXCAVATION & FOUNDATION', NULL),
  (gen_random_uuid(), '203', 'Erosion Control', 'SF', NULL, 2, 5, 10, 0.05, 1, '200 - EXCAVATION & FOUNDATION', NULL),
  (gen_random_uuid(), '204', 'Excavating & Grading', 'CY', NULL, 50, 100, 200, 0.5, 20, '200 - EXCAVATION & FOUNDATION', NULL),
  (gen_random_uuid(), '209', 'Lead-Asbestos Abatement', 'SF', NULL, 10, 25, 50, 0.2, 5, '200 - EXCAVATION & FOUNDATION', NULL),
  (gen_random_uuid(), '210', 'Soil Treatment / Pest Control', 'SF', NULL, 1, 3, 6, 0.02, 0.5, '200 - EXCAVATION & FOUNDATION', NULL),
  (gen_random_uuid(), '212', 'Concrete Foundation', 'CY', NULL, 150, 250, 400, 2.0, 100, '200 - EXCAVATION & FOUNDATION', NULL),
  (gen_random_uuid(), '215', 'Foundation Waterproofing', 'SF', NULL, 5, 12, 25, 0.1, 3, '200 - EXCAVATION & FOUNDATION', NULL),
  (gen_random_uuid(), '219', 'Rock Walls', 'SF', NULL, 35, 65, 120, 1.5, 20, '200 - EXCAVATION & FOUNDATION', NULL),

  -- 300 - ROUGH CARPENTRY
  (gen_random_uuid(), '301', 'Structural Steel', 'LB', NULL, 2.5, 4.5, 7.0, 0.02, 1.5, '300 - ROUGH CARPENTRY', NULL),
  (gen_random_uuid(), '305', 'Rough Carpentry', 'SF', NULL, 15, 25, 40, 0.3, 8, '300 - ROUGH CARPENTRY', NULL),
  (gen_random_uuid(), '307', 'Rough Lumber', 'BF', NULL, 3, 6, 12, 0.1, 2, '300 - ROUGH CARPENTRY', NULL),
  (gen_random_uuid(), '308', 'Special Registers', 'EA', NULL, 50, 150, 300, 0.5, 40, '300 - ROUGH CARPENTRY', NULL),
  (gen_random_uuid(), '310', 'Truss / Joist', 'EA', NULL, 200, 400, 800, 1.0, 150, '300 - ROUGH CARPENTRY', NULL),

  -- 400 - MEP ROUGH-INS
  (gen_random_uuid(), '402', 'HVAC', 'TON', NULL, 3000, 5000, 8000, 8.0, 2000, '400 - MEP ROUGH-INS', NULL),
  (gen_random_uuid(), '403', 'Sheet Metal', 'SF', NULL, 8, 15, 25, 0.2, 4, '400 - MEP ROUGH-INS', NULL),
  (gen_random_uuid(), '404', 'Plumbing', 'EA', NULL, 200, 350, 600, 2.0, 150, '400 - MEP ROUGH-INS', NULL),
  (gen_random_uuid(), '404B', 'Hot Mop', 'SF', NULL, 12, 20, 35, 0.3, 8, '400 - MEP ROUGH-INS', NULL),
  (gen_random_uuid(), '405', 'Electrical', 'EA', NULL, 150, 275, 450, 1.5, 100, '400 - MEP ROUGH-INS', NULL),
  (gen_random_uuid(), '406', 'Prefab Fireplaces', 'EA', NULL, 3000, 8000, 20000, 12.0, 4000, '400 - MEP ROUGH-INS', NULL),
  (gen_random_uuid(), '407', 'Low Voltage', 'EA', NULL, 100, 200, 400, 1.0, 60, '400 - MEP ROUGH-INS', NULL),
  (gen_random_uuid(), '416', 'Automatic Shades', 'EA', NULL, 800, 2000, 5000, 2.0, 1200, '400 - MEP ROUGH-INS', NULL),
  (gen_random_uuid(), '418', 'Fire Sprinkler Systems', 'EA', NULL, 5000, 12000, 25000, 20.0, 6000, '400 - MEP ROUGH-INS', NULL),
  (gen_random_uuid(), '421', 'Septic System', 'EA', NULL, 8000, 15000, 30000, 40.0, 8000, '400 - MEP ROUGH-INS', NULL),

  -- 500 - EXTERIOR VENEERS/SPEC TIES
  (gen_random_uuid(), '500', 'Masonry', 'SF', NULL, 25, 45, 75, 1.5, 15, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '503', 'Precast', 'SF', NULL, 30, 55, 90, 1.2, 20, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '504', 'Roofing', 'SF', NULL, 5, 12, 25, 0.15, 4, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '505', 'Cornices & Fascia', 'LF', NULL, 15, 35, 65, 0.4, 10, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '510', 'Garage Doors', 'EA', NULL, 800, 1500, 3000, 2.0, 1000, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '511', 'Skylights / Roof Windows', 'EA', NULL, 600, 1200, 2500, 3.0, 800, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '512', 'Solar', 'EA', NULL, 15000, 25000, 40000, 40.0, 15000, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '513', 'Wood Siding & Trim', 'SF', NULL, 12, 25, 45, 0.4, 10, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '516', 'Stucco', 'SF', NULL, 8, 18, 35, 0.3, 5, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '518', 'Shutters', 'EA', NULL, 200, 500, 1200, 0.5, 150, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '519', 'Wrought Iron', 'LF', NULL, 45, 85, 150, 1.0, 30, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '520', 'Windows', 'EA', NULL, 400, 800, 1500, 2.5, 300, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '520.001', 'Window Install', 'EA', NULL, 150, 300, 600, 2.0, 50, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '521', 'Entry Door', 'EA', NULL, 800, 2000, 5000, 3.0, 1200, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '522', 'Exterior Doors', 'EA', NULL, 500, 1200, 3000, 2.5, 700, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '550', 'Residential Elevator', 'EA', NULL, 25000, 40000, 65000, 80.0, 20000, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '552', 'Wheelchair Lifts', 'EA', NULL, 12000, 20000, 35000, 40.0, 10000, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '556', 'Wood Patios/Decks', 'SF', NULL, 18, 35, 65, 0.5, 12, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '557', 'Wine Room', 'EA', NULL, 8000, 15000, 30000, 40.0, 8000, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '560', 'Outdoor BBQ', 'EA', NULL, 2000, 5000, 12000, 8.0, 3000, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '561', 'Gazebos / Trellis', 'EA', NULL, 3000, 8000, 20000, 20.0, 4000, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),
  (gen_random_uuid(), '563', 'Deck / Water Proof Coatings', 'SF', NULL, 8, 18, 35, 0.2, 5, '500 - EXTERIOR VENEERS/SPEC TIES', NULL),

  -- 600 - INSULATION/DRYWALL
  (gen_random_uuid(), '600', 'Insulation', 'SF', NULL, 2, 5, 10, 0.05, 1.5, '600 - INSULATION/DRYWALL', NULL),
  (gen_random_uuid(), '602', 'Drywall', 'SF', NULL, 3, 8, 15, 0.2, 2, '600 - INSULATION/DRYWALL', NULL),

  -- 700 - INTERIOR FINISHES
  (gen_random_uuid(), '706', 'Finish Carpentry', 'LF', NULL, 15, 35, 65, 0.5, 12, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '706.2', 'Master Closet', 'EA', NULL, 3000, 8000, 20000, 30.0, 4000, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '707', 'Finish Lumber', 'BF', NULL, 6, 12, 25, 0.2, 4, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '710', 'Doors', 'EA', NULL, 300, 700, 1500, 1.5, 400, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '715', 'Fireplace Mantle / Trim', 'EA', NULL, 800, 2000, 5000, 8.0, 1200, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '716', 'Cabinetry Contract', 'LF', NULL, 150, 300, 600, 2.0, 200, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '719', 'Custom Hood', 'EA', NULL, 1200, 3000, 8000, 12.0, 2000, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '721', 'Solid Surface Countertops', 'SF', NULL, 50, 100, 200, 1.0, 60, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '723', 'Paint', 'SF', NULL, 2, 4, 8, 0.05, 1, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '726', 'Faux Finishes', 'SF', NULL, 8, 18, 35, 0.3, 4, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '728', 'Tile', 'SF', NULL, 10, 25, 50, 0.4, 12, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '733', 'Vinyl Floor', 'SF', NULL, 3, 8, 18, 0.2, 4, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '734', 'Wood Floor', 'SF', NULL, 8, 18, 35, 0.4, 10, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '737', 'Carpet', 'SF', NULL, 5, 12, 25, 0.2, 6, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '738', 'Shower Encl/Mirrors/Misc Glass', 'EA', NULL, 400, 1000, 2500, 3.0, 500, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '739', 'Plumbing Fixtures / Bath Acces', 'EA', NULL, 250, 600, 1500, 2.0, 350, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '740', 'Lighting Fixtures', 'EA', NULL, 150, 400, 1000, 1.5, 200, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '741', 'Appliances', 'EA', NULL, 500, 1500, 5000, 3.0, 800, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '742', 'Appliance Installation', 'EA', NULL, 150, 300, 600, 2.0, 50, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '743', 'Steel / Metal Stairs', 'EA', NULL, 3000, 8000, 20000, 30.0, 4000, '700 - INTERIOR FINISHES', NULL),
  (gen_random_uuid(), '745', 'Wood Stairs & Rails', 'LF', NULL, 45, 100, 200, 1.5, 30, '700 - INTERIOR FINISHES', NULL),

  -- 800 - COMPLETION & FINAL IMPROVEMENT
  (gen_random_uuid(), '800', 'Concrete Flatwork', 'SF', NULL, 6, 15, 30, 0.2, 5, '800 - COMPLETION & FINAL IMPROVEMENT', NULL),
  (gen_random_uuid(), '803', 'Special Concrete Finishes', 'SF', NULL, 12, 25, 50, 0.4, 8, '800 - COMPLETION & FINAL IMPROVEMENT', NULL),
  (gen_random_uuid(), '804', 'Fencing', 'LF', NULL, 25, 50, 100, 0.5, 20, '800 - COMPLETION & FINAL IMPROVEMENT', NULL),
  (gen_random_uuid(), '805', 'Landscape', 'SF', NULL, 3, 8, 18, 0.1, 2, '800 - COMPLETION & FINAL IMPROVEMENT', NULL),
  (gen_random_uuid(), '808', 'Landscape Lighting', 'EA', NULL, 200, 500, 1200, 1.0, 300, '800 - COMPLETION & FINAL IMPROVEMENT', NULL),
  (gen_random_uuid(), '809', 'Pool / Spa Construction', 'EA', NULL, 30000, 60000, 120000, 200.0, 40000, '800 - COMPLETION & FINAL IMPROVEMENT', NULL),
  (gen_random_uuid(), '810', 'Finish Hardware', 'EA', NULL, 50, 150, 400, 0.3, 80, '800 - COMPLETION & FINAL IMPROVEMENT', NULL),
  (gen_random_uuid(), '813', 'Decorating', 'JOB', NULL, 5000, 15000, 40000, NULL, NULL, '800 - COMPLETION & FINAL IMPROVEMENT', NULL),
  (gen_random_uuid(), '816', 'Asphalt Paving', 'SF', NULL, 3, 8, 15, 0.1, 2, '800 - COMPLETION & FINAL IMPROVEMENT', NULL),
  (gen_random_uuid(), '817', 'Final Cleaning', 'JOB', NULL, 500, 1500, 3500, NULL, NULL, '800 - COMPLETION & FINAL IMPROVEMENT', NULL)

ON CONFLICT (cost_code) 
DO UPDATE SET
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  notes = EXCLUDED.notes;

-- Add comment to document this migration
COMMENT ON TABLE public.task_library IS 'Master library of construction tasks and cost codes. Used for semantic search and pricing lookup.';

