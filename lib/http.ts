export type Ctx = { params: Promise<{ id: string }> };
export const json = (data: unknown, status = 200) => Response.json(data, { status });
export const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status });
