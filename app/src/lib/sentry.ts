// Error tracking (Sentry), shared by the browser and the server. Off until a project's address is set
// (NEXT_PUBLIC_SENTRY_DSN), as on localnet and in tests. The address is public: it can only receive errors.

export const sentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.ONEUP_ENV,
  // errors only: no performance traces and no session recordings
  tracesSampleRate: 0,
  sendDefaultPii: false,
};
