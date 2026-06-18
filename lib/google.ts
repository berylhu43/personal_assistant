import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

/**
 * Returns an authenticated OAuth2 client built from the current session's
 * access token, or null if the user is not authenticated.
 */
export async function getGoogleAuth() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) return null;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ access_token: session.accessToken });
  return oauth2Client;
}

export function calendarClient(auth: any) {
  return google.calendar({ version: "v3", auth });
}

export function gmailClient(auth: any) {
  return google.gmail({ version: "v1", auth });
}
