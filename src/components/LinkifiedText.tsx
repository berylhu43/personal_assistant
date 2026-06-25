import { openExternal } from "../lib/openExternal";

// Split on http(s) URLs, keeping them (capturing group) so we can render each as
// a clickable link that opens in the system browser.
const URL_RE = /(https?:\/\/[^\s]+)/g;

/** Render multi-line free-form text with any URLs as clickable links. */
export default function LinkifiedText({ text }: { text: string }) {
  return (
    <div className="selectable space-y-0.5">
      {text.split(/\r?\n/).map((line, li) => (
        <p key={li} className="font-sans text-[11px] leading-snug text-ink/65">
          {line.split(URL_RE).map((part, pi) =>
            /^https?:\/\//.test(part) ? (
              <button
                key={pi}
                onClick={() => void openExternal(part)}
                title="Open in browser"
                className="break-all text-left text-gold-deep underline-offset-2 hover:underline"
              >
                {part}
              </button>
            ) : (
              <span key={pi}>{part}</span>
            )
          )}
        </p>
      ))}
    </div>
  );
}
