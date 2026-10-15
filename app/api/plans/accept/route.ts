import { authenticatedOwner, errorResponse, jsonResponse, readJson } from "../../../../lib/http";
import { WorkspaceService } from "../../../../lib/workspace-service";
import { D1WorkspaceRepository } from "../../../../lib/workspace-repository";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const owner = await authenticatedOwner();
    return jsonResponse(await new WorkspaceService(new D1WorkspaceRepository()).accept(owner, await readJson(request)));
  } catch (error) { return errorResponse(error); }
}
