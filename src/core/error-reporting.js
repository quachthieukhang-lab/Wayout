/**
 * Crash reports from players' machines, through Sentry. Off unless all of these hold: a production build, a DSN in
 * `VITE_SENTRY_DSN` at build time, and the player has not switched reports off in Settings. The SDK is loaded on demand,
 * so a build without a DSN, or a player who opted out, never downloads it. Nothing personal is sent: no IP address,
 * no cookies, no user, and no tracing or replays — only the error, the browser and the game version.
 * @param {{ dsn: string | undefined, release: string, isEnabled: boolean, isProduction: boolean }} options
 * @returns {Promise<boolean>} whether reporting started
 */
export async function startErrorReporting({ dsn, release, isEnabled, isProduction }) {
  if (!dsn || !isEnabled || !isProduction) return false;
  try {
    const Sentry = await import('./sentry-sdk.js');
    Sentry.init({
      dsn,
      release: `way-out@${release}`,
      dataCollection: { userInfo: false, cookies: false, urlQueryParams: false },
      tracesSampleRate: 0,
      defaultIntegrations: false,
      integrations: [
        Sentry.globalHandlersIntegration(),
        Sentry.dedupeIntegration(),
        Sentry.linkedErrorsIntegration(),
        Sentry.browserApiErrorsIntegration(),
      ],
    });
    return true;
  } catch (error) {
    console.warn('Crash reporting could not start; the game plays on without it.', error);
    return false;
  }
}
