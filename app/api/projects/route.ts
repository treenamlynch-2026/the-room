import { createProject, listProjects } from "@/lib/db";
import { seedIfEmpty } from "@/lib/seed";
import { bad, json } from "@/lib/http";

export async function GET() {
  seedIfEmpty();
  return json(listProjects());
}
export async function POST(req: Request) {
  const { name, description } = await req.json();
  if (!name?.trim()) return bad("name required");
  return json(createProject(name.trim(), description));
}
