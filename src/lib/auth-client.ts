import { createAuthClient } from "better-auth/react";

// Client-side hooks (useSession, signIn, signOut, ...) for use in
// Client Components such as the login form. No baseURL is passed —
// Better Auth defaults to same-origin requests in the browser, so this
// works correctly on localhost, on every Vercel preview URL, and on
// production without needing to know the URL ahead of time.
export const authClient = createAuthClient();

export const { signIn, signOut, signUp, useSession } = authClient;
