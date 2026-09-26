import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Better Auth's own endpoints (sign in, sign out, session, etc.) all live
// under /api/auth/*. Nothing business-specific goes here.
export const { GET, POST } = toNextJsHandler(auth);
