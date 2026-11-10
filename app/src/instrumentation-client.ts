// Runs in the browser before the app starts: every uncaught error and failed transaction goes to Sentry
// (lib/sentry.ts, lib/report.ts).

import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry";

Sentry.init(sentryOptions);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
