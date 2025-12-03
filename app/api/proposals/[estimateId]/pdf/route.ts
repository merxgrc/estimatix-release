/**
 * DEPRECATED: This route is maintained for backward compatibility.
 * Please use /api/spec-sheets/[estimateId]/pdf instead.
 * 
 * This route forwards to the new implementation with a deprecation warning.
 */
import { GET as getSpecSheet } from "@/app/api/spec-sheets/[estimateId]/pdf/route";

export async function GET(req: Request, context: { params: Promise<{ estimateId: string }> }) {
  console.warn("Deprecated: /api/proposals/[estimateId]/pdf route used. Please migrate to /api/spec-sheets/[estimateId]/pdf");
  return getSpecSheet(req, context);
}
