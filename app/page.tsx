import { requireChatGPTUser } from "./chatgpt-auth";
import ClientApp from "./components/client-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <ClientApp userName={user.displayName} />;
}
