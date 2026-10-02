// Vercel entry point. The connector URL is https://<your-project>.vercel.app/mcp/<BRIDGE_TOKEN>
// (time limit is set in vercel.json)
import { handle } from "../lib/mcp.js";

const run = (request) => handle(request, process.env);
export const GET = run;
export const POST = run;
export const DELETE = run;
