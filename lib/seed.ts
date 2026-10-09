import { createCanon, createProject, listProjects } from "./db";

/** First run only: create a blank example project. */
export function seedIfEmpty() {
  if (listProjects().length) return;
  const p = createProject("Example project", "Edit, rename or archive it freely.");
  createCanon(p.id, { title: "Example canon entry", body: "[Rules every model call must follow go here]", priority: 2, source: "", pinned: false });
}
