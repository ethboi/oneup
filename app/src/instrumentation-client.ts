// Runs in the browser before the app starts: every uncaught error and failed transaction goes to Sentry
// (lib/sentry.ts, lib/report.ts).

import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry";

Sentry.init(sentryOptions);

// MetaMask's in-app browser reports each navigation to the wallet with the og:site_name element itself as the title
// (JSON.stringify of a DOM node). React keeps its own properties on that node, so the call threw "Converting circular
// structure to JSON" on every tab change and the wallet never heard about the navigation. Written out as its content,
// the wallet gets the name.
if (typeof HTMLMetaElement !== "undefined") {
  Object.defineProperty(HTMLMetaElement.prototype, "toJSON", { configurable: true, value(this: HTMLMetaElement) { return this.content; } });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
