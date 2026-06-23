import { useEffect, useState } from "react";
import { getApiKey, setApiKey } from "../lib/store";

export default function Settings({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getApiKey().then((k) => setHasKey(!!k));
  }, []);

  async function save() {
    if (!key.trim()) return;
    await setApiKey(key.trim());
    setSaved(true);
    setHasKey(true);
    onSaved();
    setTimeout(onClose, 600);
  }

  return (
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 px-6"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ backgroundColor: "#FBF7EF" }}
        className="no-drag rise w-full max-w-sm rounded-2xl border border-ink/15 p-6 shadow-lift"
      >
        <span className="eyebrow">Settings</span>
        <h3 className="mt-1 font-serif text-2xl text-ink">Your keys</h3>
        <p className="mt-1.5 font-sans text-xs leading-relaxed text-ink/60">
          Your Anthropic API key is stored locally and never leaves this machine.
        </p>

        <label className="mt-5 block font-mono text-[10px] uppercase tracking-wide text-ink/60">
          Anthropic API key{" "}
          {hasKey && <span className="text-done">· set</span>}
        </label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={hasKey ? "Enter a new key to replace" : "sk-ant-…"}
          style={{ backgroundColor: "#FFFFFF" }}
          className="selectable focus-gold mt-1.5 w-full rounded-lg border border-ink/20 px-3 py-2.5 font-mono text-sm text-ink transition"
        />

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="font-sans text-sm text-ink/55 transition hover:text-ink"
          >
            Close
          </button>
          <button
            onClick={save}
            disabled={!key.trim()}
            className="rounded-full bg-ink px-5 py-2 font-sans text-sm font-medium text-cream shadow-memo transition hover:bg-gold-deep disabled:opacity-40 disabled:hover:bg-ink"
          >
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
