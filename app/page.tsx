"use client";

import { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import type { CalendarEvent, PendingEmail } from "@/lib/types";
import BriefingPanel from "@/components/BriefingPanel";
import ChatPanel from "@/components/ChatPanel";
import SignInScreen from "@/components/SignInScreen";

export default function Home() {
  const { data: session, status } = useSession();

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [emails, setEmails] = useState<PendingEmail[]>([]);
  const [loadingBriefing, setLoadingBriefing] = useState(true);
  const [briefingError, setBriefingError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;

    let cancelled = false;
    async function loadBriefing() {
      setLoadingBriefing(true);
      setBriefingError(null);
      try {
        const [calRes, mailRes] = await Promise.all([
          fetch("/api/calendar/today"),
          fetch("/api/gmail/pending"),
        ]);
        const calData = await calRes.json();
        const mailData = await mailRes.json();
        if (cancelled) return;
        setEvents(calData.events ?? []);
        setEmails(mailData.emails ?? []);
        if (!calRes.ok || !mailRes.ok) {
          setBriefingError(
            "Some data couldn't be loaded. Check your Google permissions."
          );
        }
      } catch {
        if (!cancelled) setBriefingError("Failed to load your briefing.");
      } finally {
        if (!cancelled) setLoadingBriefing(false);
      }
    }
    loadBriefing();
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === "loading") {
    return (
      <main className="flex h-screen items-center justify-center bg-cream">
        <p className="font-serif text-2xl text-ink/40">Loading…</p>
      </main>
    );
  }

  if (status !== "authenticated") {
    return <SignInScreen onSignIn={() => signIn("google")} />;
  }

  return (
    <main className="flex h-screen w-full flex-col md:flex-row overflow-hidden">
      <BriefingPanel
        events={events}
        emails={emails}
        loading={loadingBriefing}
        error={briefingError}
        userName={session?.user?.name ?? null}
      />
      <ChatPanel calendarEvents={events} pendingEmails={emails} />
    </main>
  );
}
