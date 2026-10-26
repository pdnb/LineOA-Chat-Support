/**
 * Environment access. Read lazily on every call so values loaded after import
 * (custom server's loadEnvConfig, tests overriding process.env) are picked up.
 */
export const env = {
  get jwtSecret() {
    const v = process.env.JWT_SECRET;
    if (!v) throw new Error('JWT_SECRET is not set');
    return v;
  },
  get jwtExpiresIn() {
    return process.env.JWT_EXPIRES_IN || '12h';
  },
  /** Optional Auth0 login; the console shows the Auth0 button only when all three are set. */
  get auth0Domain() {
    return (process.env.AUTH0_DOMAIN ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '') || undefined;
  },
  get auth0ClientId() {
    return process.env.AUTH0_CLIENT_ID || undefined;
  },
  get auth0ClientSecret() {
    return process.env.AUTH0_CLIENT_SECRET || undefined;
  },
  get auth0Enabled() {
    return !!(this.auth0Domain && this.auth0ClientId && this.auth0ClientSecret);
  },
  get publicBaseUrl() {
    return (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  },
  /** Legacy single-OA config: only copied into the default channel once (importEnvCredentials). */
  get lineChannelSecret() {
    return process.env.LINE_CHANNEL_SECRET || undefined;
  },
  get lineAccessToken() {
    return process.env.LINE_CHANNEL_ACCESS_TOKEN || undefined;
  },
  get autoAssign() {
    return process.env.AUTO_ASSIGN === 'true';
  },
  get queueWorker() {
    return process.env.QUEUE_WORKER !== 'false';
  },
  get queuePollMs() {
    return Number(process.env.QUEUE_POLL_MS ?? 500);
  },
  get queueMaxAttempts() {
    return Number(process.env.QUEUE_MAX_ATTEMPTS ?? 5);
  },
  get queueBackoffMs() {
    return Number(process.env.QUEUE_BACKOFF_MS ?? 2000);
  },
};
