import { getMessage, updateMessage } from "@/lib/db";
import { bad, json, type Ctx } from "@/lib/http";

export async function PATCH(req: Request, { params }: Ctx) {
  const id = (await params).id;
  if (!getMessage(id)) return bad("not found", 404);
  const { approved } = await req.json();
  updateMessage(id, { approved: !!approved, approvedBy: approved ? process.env.HUMAN_NAME || "Human" : null });
  return json(getMessage(id));
}
