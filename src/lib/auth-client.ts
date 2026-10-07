import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// Client-side hooks (useSession, signIn, signOut, ...) for use in
// Client Components such as the login form. No baseURL is passed —
// Better Auth defaults to same-origin requests in the browser, so this
// works correctly on localhost, on every Vercel preview URL, and on
// production without needing to know the URL ahead of time.
export const LOGIN_NEXT_STORAGE_KEY = "appliance-desk-post-login-next";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      twoFactorPage: "/login/two-factor",
    }),
  ],
});

export const { signIn, signOut, signUp, useSession } = authClient;
