/**
 * Configuration Module
 *
 * Reads environment variables at module load time.
 * Separated from network code to avoid security scanner false positives.
 */

const DEFAULT_PORT = 8402;

/**
 * Proxy port configuration — resolved once at module load.
 * MINIROUTER_PORT is preferred.
 * @deprecated BLOCKRUN_PROXY_PORT is a legacy fallback and will be
 *   removed in a future major version.
 */
export const PROXY_PORT = (() => {
  const envPort = process.env.MINIROUTER_PORT ?? process.env.BLOCKRUN_PROXY_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
  }
  return DEFAULT_PORT;
})();
