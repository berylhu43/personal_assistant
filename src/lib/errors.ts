import { MissingApiKeyError } from "./anthropic";

/**
 * Map an error to a plain-language, user-safe message. Never returns a raw
 * error string, URL, or stack detail — log the original with console.error for
 * debugging instead.
 */
export function friendlyError(e: unknown): string {
  if (e instanceof MissingApiKeyError) {
    return "Add your Anthropic API key in Settings and I'll be ready.";
  }

  const msg = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();

  // Network / connectivity failures (fetch transport, timeouts, offline).
  if (
    /error sending request|failed to fetch|networkerror|timed? out|timeout|offline|connection|dns|econn|enotfound|err_internet/.test(
      msg
    )
  ) {
    return "You appear to be offline. Check your connection and try again.";
  }

  // Anthropic API key problems.
  if (
    /anthropic api error 401|anthropic api error 403|invalid x-api-key|invalid api key|authentication_error/.test(
      msg
    )
  ) {
    return "There's a problem with your API key — check it in Settings.";
  }

  // Google auth/token expiry.
  if (
    /google is not connected|googleapis|gmail api error 401|calendar api error 401|sign in again|invalid_grant|unauthorized/.test(
      msg
    )
  ) {
    return "Your Google connection expired — please sign in again.";
  }

  return "Something went wrong. Please try again.";
}
