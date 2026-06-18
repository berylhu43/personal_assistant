"use client";

export default function SignInScreen({ onSignIn }: { onSignIn: () => void }) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="ruled-paper flex h-screen items-center justify-center px-6">
      <div className="margin-line w-full max-w-md py-12 pl-16 pr-6">
        <p className="font-sans text-xs uppercase tracking-[0.2em] text-gold">
          {today}
        </p>
        <h1 className="mt-2 font-serif text-5xl leading-tight text-ink">
          Your desk,
          <br />
          thinking ahead.
        </h1>
        <p className="mt-5 max-w-sm font-sans text-sm leading-relaxed text-ink/70">
          A memo-style assistant that reads your calendar and inbox, tracks your
          goals, and plans the week with you.
        </p>
        <button
          onClick={onSignIn}
          className="mt-8 inline-flex items-center gap-3 rounded-full bg-ink px-6 py-3 font-sans text-sm font-medium text-cream transition hover:opacity-90"
        >
          <GoogleMark />
          Continue with Google
        </button>
        <p className="mt-4 font-sans text-xs text-ink/40">
          We request read access to Calendar &amp; Gmail, and permission to add
          calendar events.
        </p>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 5.1 29.4 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 5.1 29.4 3 24 3 16 3 9.1 7.6 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 45c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 36 26.7 37 24 37c-5.3 0-9.7-2.6-11.3-7l-6.5 5C9.1 42.3 16 45 24 45z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.1-2.2 3.9-4 5.2l6.3 5.3C41.4 36 45 30.6 45 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
