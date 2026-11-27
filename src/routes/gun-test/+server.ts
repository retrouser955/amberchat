import { json } from "@sveltejs/kit";

// Temporary diagnostic route. Safe to delete.
export function GET() {
	return json({ ok: true });
}
