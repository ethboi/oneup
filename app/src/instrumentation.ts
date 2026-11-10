// Runs once when the server starts: errors in pages and API routes go to Sentry (lib/sentry.ts).

import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry";

export function register() {
  Sentry.init(sentryOptions);
}

export const onRequestError = Sentry.captureRequestError;
