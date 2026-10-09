import { searchMessages } from "@/lib/db";
import { json, type Ctx } from "@/lib/http";

export async function GET(req: Request, { params }: Ctx) {
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  return json(q ? searchMessages((await params).id, q) : []);
}
