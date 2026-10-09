import { listModels } from "@/lib/agents/adapters";
import { json } from "@/lib/http";

export async function GET() {
  return json(await listModels());
}
