import { authenticatedOwner, errorResponse, jsonResponse, readJson } from "../../../lib/http";
import { WorkspaceService } from "../../../lib/workspace-service";
import { D1WorkspaceRepository } from "../../../lib/workspace-repository";
export const dynamic = "force-dynamic";
const service = () => new WorkspaceService(new D1WorkspaceRepository());
export async function GET() {
  try { return jsonResponse(await service().get(await authenticatedOwner())); }
  catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request) {
  try { const owner = await authenticatedOwner(); return jsonResponse(await service().save(owner, await readJson(request))); }
  catch (error) { return errorResponse(error); }
}
