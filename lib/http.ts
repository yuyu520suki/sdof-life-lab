import { getChatGPTUser } from "../app/chatgpt-auth";
import { MAX_DOCUMENT_BYTES, ServiceError } from "./workspace-service";

export async function authenticatedOwner(): Promise<string> {
  const user = await getChatGPTUser();
  if (!user) throw new ServiceError(401, "请先登录。");
  return user.userId;
}
export async function readJson(request: Request): Promise<unknown> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new ServiceError(403, "不接受跨站写入。");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ServiceError(415, "请使用 JSON 格式提交。");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_DOCUMENT_BYTES + 4096) throw new ServiceError(413, "提交内容过大。");
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError(400, "提交内容为空。");
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOCUMENT_BYTES + 4096) { await reader.cancel(); throw new ServiceError(413, "提交内容过大。"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ServiceError(400, "JSON 内容无法解析。"); }
  } finally { reader.releaseLock(); }
}
export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export function errorResponse(error: unknown): Response {
  if (error instanceof ServiceError) return jsonResponse({ error: error.message, details: error.details }, error.status);
  console.error("Workspace request failed", error instanceof Error ? error.message : "unknown");
  return jsonResponse({ error: "保存服务暂时不可用。请保留当前修改后重试；需要时可先导出。" }, 503);
}
