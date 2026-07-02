/**
 * Picker-visible BlockRun models.
 *
 * The database-backed dashboard uses /api/models and does not depend on this
 * list. Keep this module present so the HTTP server can import src/models.ts;
 * the OpenAI-compatible /v1/models route still adds MiniRouter virtual models.
 */
export const TOP_MODELS: string[] = [];
