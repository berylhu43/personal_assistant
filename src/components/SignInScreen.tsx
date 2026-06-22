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
      className="ruled-paper margin-line relative flex h-full flex-col justify-center overflow-hidden px-7 pl-12"
    >
      {/* faint oversized seal in the corner */}
      <span className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full border border-gold/20" />
      <span className="pointer-events-none absolute -right-2 top-3 font-serif text-[120px] leading-none text-gold/10 select-none">
        ✦
      </span>

      <div className="rise" style={{ animationDelay: "40ms" }}>
        <p className="eyebrow">{today}</p>
      </div>
      <h1
        className="rise mt-3 font-serif text-[34px] leading-[1.05] text-ink"
        style={{ animationDelay: "100ms" }}
      >
        Your desk,
        <br />
        <span className="text-gold-deep">thinking ahead.</span>
      </h1>
      <p
        className="rise mt-3.5 max-w-[16rem] font-sans text-[13px] leading-relaxed text-ink/65"
        style={{ animationDelay: "160ms" }}
      >
        An always-on memo that reads your calendar and inbox, tracks goals, and
        plans the week with you.
      </p>
      <button
        onClick={handle}
        disabled={busy}
        style={{ animationDelay: "220ms" }}
        className="no-drag rise lift mt-7 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-ink px-6 py-3 font-sans text-sm font-medium text-cream shadow-memo transition hover:shadow-lift disabled:opacity-50"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full bg-gold ${busy ? "animate-ping" : ""}`}
        />
        {busy ? "Connecting…" : "Continue with Google"}
      </button>
      {error && (
        <p className="mt-3.5 max-w-[18rem] rounded-md bg-red-900/5 px-3 py-2 font-mono text-[11px] leading-snug text-red-800/80">
          {error}
        </p>
      )}
      <p className="mt-4 max-w-[16rem] font-sans text-[11px] leading-relaxed text-ink/40">
        Requests read access to Calendar &amp; Gmail, and permission to add
        events.
      </p>
    </div>
  );
}
