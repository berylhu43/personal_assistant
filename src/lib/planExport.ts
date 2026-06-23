import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { getPlanByGoal } from "./plans";
import { getGoalById } from "./goals";
import type { PlanDay } from "./types";

const KIND_LABELS: Record<string, string> = {
  repo: "Repos",
  article: "Articles",
  doc: "Docs",
  code: "Code",
};

/** Render a learning plan as a readable Markdown document. */
export function planToMarkdown(
  title: string,
  targetDate: string | null,
  days: PlanDay[]
): string {
  const out: string[] = [`# ${title}`, ""];
  if (targetDate) out.push(`**Target date:** ${targetDate}`, "");

  for (const d of days) {
    out.push(`## ${d.date}${d.topic ? ` — ${d.topic}` : ""}`);
    if (d.task) out.push(`- **Task:** ${d.task}`);
    if (d.practice) out.push(`- **Practice:** ${d.practice}`);
    if (d.est_time) out.push(`- **Est. time:** ${d.est_time}`);

    if (d.resources?.length) {
      out.push("", "**Resources:**");
      // Group resources by kind (repo / article / doc / code), labeled.
      const byKind = new Map<string, PlanDay["resources"]>();
      for (const r of d.resources) {
        const k = r.kind || "other";
        if (!byKind.has(k)) byKind.set(k, []);
        byKind.get(k)!.push(r);
      }
      for (const [kind, list] of byKind) {
        out.push("", `_${KIND_LABELS[kind] ?? kind}_`);
        for (const r of list ?? []) {
          out.push(`- [${r.title}](${r.url})`);
        }
      }
    }
    out.push("");
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "plan"
  );
}

/**
 * Export the plan document for a goal as a Markdown file via the OS save
 * dialog. No-op if the user cancels the dialog or no plan exists.
 */
export async function downloadPlan(goalId: string): Promise<void> {
  const row = await getPlanByGoal(goalId);
  if (!row) return;

  let days: PlanDay[] = [];
  try {
    const parsed = JSON.parse(row.content);
    days = Array.isArray(parsed) ? parsed : [];
  } catch {
    days = [];
  }

  const goal = await getGoalById(goalId).catch(() => null);
  const md = planToMarkdown(row.title, goal?.targetDate ?? null, days);

  const path = await save({
    defaultPath: `${slug(row.title)}-plan.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return; // user cancelled

  await writeTextFile(path, md);
}
