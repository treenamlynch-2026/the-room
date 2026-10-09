import { json, type Ctx } from "@/lib/http";
import { running } from "@/lib/run";

export async function POST(_: Request, { params }: Ctx) {
  const ac = running.get((await params).id);
  ac?.abort();
  return json({ stopped: !!ac });
}
