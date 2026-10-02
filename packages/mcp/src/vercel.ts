// Vercel Function entry (bundled by scripts/build-mcp.mjs into packages/web/api/mcp.js).
import { handleHttp } from "./http.ts";

const env = (k: string) => process.env[k];

export const POST = (req: Request) => handleHttp(req, env);
export const GET = (req: Request) => handleHttp(req, env);
export const DELETE = (req: Request) => handleHttp(req, env);
export const OPTIONS = (req: Request) => handleHttp(req, env);
