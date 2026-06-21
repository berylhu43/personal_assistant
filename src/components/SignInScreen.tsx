import { useState } from "react";

export default function SignInScreen({
  onSignIn,
}: {
  onSignIn: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  async function handle() {
    setBusy(true);
    setError(null);
    try {
      await onSignIn();
    } catch (e: any) {
      // The Tauri plugin often rejects with a plain string, so e.message is
      // undefined — surface whatever shape the error actually is.
      console.error("sign-in error:", e);
      const msg =
        typeof e === "string"
          ? e
          : e?.message ?? (e ? JSON.stringify(e) : "");
      setError(msg || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-tauri-drag-region
      className="ruled-paper margin-line flex h-full flex-col justify-center px-6 pl-12"
    >
      <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-gold">
        {today}
      </p>
      <h1 className="mt-2 font-serif text-3xl leading-tight text-ink">
        Your desk,
        <br />
        thinking ahead.
      </h1>
      <p className="mt-3 font-sans text-xs leading-relaxed text-ink/65">
        An always-on memo that reads your calendar and inbox, tracks goals, and
        plans the week with you.
      </p>
      <button
        onClick={handle}
        disabled={busy}
        className="no-drag mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 font-sans text-sm font-medium text-cream transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Connecting…" : "Continue with Google"}
      </button>
      {error && (
        <p className="mt-3 font-sans text-xs text-red-700/80">{error}</p>
      )}
      <p className="mt-3 font-sans text-[11px] text-ink/40">
        Requests read access to Calendar &amp; Gmail, and permission to add
        events.
      </p>
    </div>
  );
}
