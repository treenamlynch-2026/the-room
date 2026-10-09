import { createCanon, getState } from "@/lib/db";
import { json, type Ctx } from "@/lib/http";

export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  createCanon(id, await req.json());
  return json(getState(id)!.canon);
}
