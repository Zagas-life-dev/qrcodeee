import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/supabase/session";

/**
 * The entry point, which is only ever a fork: signed in goes to the profile,
 * signed out goes to sign-in.
 *
 * The redirect lives in a Suspense-wrapped child rather than in the page body
 * because reading the session is runtime data, and under Cache Components
 * (next.config.ts) that has to sit inside a boundary or it blocks the route from
 * prerendering. There is no content here to build a skeleton from — the whole
 * page is the decision — so the fallback is deliberately empty rather than a
 * splash that would flash for the length of one auth round trip.
 *
 * A `loading.tsx` would have been the usual way to get this boundary, but at the
 * app root it would also become the fallback for every route that doesn't
 * declare its own, which is the "loading.js too high in the tree" problem: those
 * routes would each drop to one generic full-page skeleton instead of streaming
 * their own shape.
 */
export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeRedirect />
    </Suspense>
  );
}

/**
 * Annotated rather than inferred. `redirect()` is typed `never`, so the end of
 * this function is unreachable and TypeScript infers `Promise<void>` — which is
 * not a valid JSX component type. Declaring `Promise<null>` states what the
 * component contributes to the tree (nothing) and type-checks, because the
 * unreachable end point satisfies any declared return.
 */
async function HomeRedirect(): Promise<null> {
  const user = await getSessionUser();
  redirect(user ? "/profile" : "/login");
}
