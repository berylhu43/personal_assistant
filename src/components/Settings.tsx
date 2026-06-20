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
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/30 px-6">
      <div className="no-drag w-full max-w-sm rounded-xl border border-ink/10 bg-white p-5 shadow-xl">
        <h3 className="font-serif text-xl text-ink">Settings</h3>
        <p className="mt-1 font-sans text-xs text-ink/55">
          Your Anthropic API key is stored locally and never leaves this machine.
        </p>

        <label className="mt-4 block font-sans text-xs font-medium text-ink/70">
          Anthropic API key {hasKey && <span className="text-done">· set</span>}
        </label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={hasKey ? "•••••••• (enter to replace)" : "sk-ant-…"}
          className="selectable mt-1 w-full rounded-lg border border-ink/15 bg-cream/40 px-3 py-2 font-sans text-sm text-ink focus:border-gold focus:outline-none"
        />

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="font-sans text-sm text-ink/50 hover:text-ink"
          >
            Close
          </button>
          <button
            onClick={save}
            disabled={!key.trim()}
            className="rounded-lg bg-ink px-4 py-2 font-sans text-sm font-medium text-cream transition hover:opacity-90 disabled:opacity-40"
          >
            {saved ? "✓ Saved" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
