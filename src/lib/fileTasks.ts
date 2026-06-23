import { open } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { chat } from "./anthropic";

// pdf.js runs its parser in a Web Worker; point it at the bundled worker.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_CHARS = 40_000; // cap text sent to the model (fits a full syllabus)
const ALLOWED = ["pdf", "txt", "md"];

/** A deliverable extracted from an uploaded document, pending user confirmation. */
export interface AssignmentCandidate {
  title: string;
  due: string; // absolute YYYY-MM-DD
  type: "assignment" | "exam" | "quiz" | "reading";
  note?: string;
}

export interface ExtractionResult {
  course: string | null;
  items: AssignmentCandidate[];
  // True when the model couldn't confidently determine due dates and needs the
  // user to supply missing info (e.g. the term start date) rather than guess.
  needsInfo: boolean;
  question: string | null;
}

/** Carries a user-facing message (scanned PDF, unsupported type, etc.). */
export class FileExtractError extends Error {}

/** Local date as YYYY-MM-DD, for resolving relative deadlines. */
function todayStr(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function extOf(path: string): string {
  return path.slice(path.lastIndexOf(".") + 1).toLowerCase();
}

function baseName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

/**
 * Open a file picker (pdf / txt / md). Returns the chosen path, or null if the
 * user cancelled.
 */
export async function pickDocument(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Documents", extensions: ALLOWED }],
  });
  return typeof selected === "string" ? selected : null;
}

async function extractPdfText(path: string): Promise<string> {
  const bytes = await readFile(path);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ");
    parts.push(text);
  }
  return parts.join("\n");
}

/**
 * Read a document's plain text. Throws FileExtractError with a user-facing
 * message for unsupported types or scanned (image-only) PDFs.
 */
export async function extractText(
  path: string
): Promise<{ name: string; text: string }> {
  const name = baseName(path);
  const ext = extOf(path);
  if (!ALLOWED.includes(ext)) {
    throw new FileExtractError(
      "That file type isn't supported — please attach a PDF, .txt, or .md file."
    );
  }

  let text: string;
  if (ext === "pdf") {
    text = await extractPdfText(path);
    // Almost no text means a scanned / image-only PDF — pdf.js can't OCR.
    if (text.replace(/\s/g, "").length < 20) {
      throw new FileExtractError(
        `"${name}" looks like a scanned PDF — I couldn't read any text from it. Try a text-based PDF or paste the content directly.`
      );
    }
  } else {
    text = await readTextFile(path);
  }

  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
  return { name, text };
}

const EXTRACT_SYSTEM = `You read the text of a course syllabus or assignment document and extract the graded/required deliverables the student must complete (problem sets, mini-projects, essays, quizzes, exams, presentations, etc.).

Return ONLY JSON of this exact shape (no prose, no markdown fences):
{ "course": "CS101", "needsInfo": false, "question": null, "items": [ { "title": "Problem Set 1", "due": "YYYY-MM-DD", "type": "assignment", "note": "optional short detail" } ] }

Rules:
- course: the course code or name if clearly identifiable, otherwise null.
- items: every distinct required/graded deliverable for which you can determine a CONFIDENT due date. Schedule tables often list these by WEEK in a "Due", "Due / Quiz", or "Assignment" column (e.g. "PS 1" in Week 3, a quiz, a midterm, a final). Expand abbreviations using the syllabus's own legend (e.g. "PS" = "Problem Set", "MP" = "Mini-Project").
- title: short and specific (e.g. "Problem Set 1", "Mini-Project 2", "Final Exam").
- due: ABSOLUTE date YYYY-MM-DD. To resolve a week-relative deadline ("Week 3", "by Friday") you need the term's Week 1 start date and any day-of-week rule (e.g. "assignments due Thursday evenings", "quizzes on Fridays"). Use explicit dates given in the document OR in the user's additional context.
- type: one of "assignment", "exam", "quiz", "reading". Problem sets / projects / essays = "assignment".
- note: optional short detail (weight, format, related reading) — keep brief, omit if nothing useful.

WHEN YOU CANNOT DETERMINE CONFIDENT DUE DATES — ASK, DO NOT GUESS:
- If the deliverables are week-relative (or otherwise undated) and NEITHER the document NOR the user's additional context gives you a reliable anchor (the term / Week 1 start date, or explicit calendar dates), DO NOT estimate or guess. Instead set "needsInfo": true, "items": [], and "question" to a SPECIFIC, friendly question asking for exactly what you need — e.g. "This syllabus lists assignments by week but gives no calendar dates. What date does Week 1 (or the term) begin? I'll work out the rest." If a day-of-week rule for deadlines is also missing, ask for that too.
- When "needsInfo" is false, "question" must be null.
- Never fabricate or approximate a date just to fill the field. A confident date or an honest question — never a guess.

- IGNORE office hours, grading policies, course descriptions, and recommended/optional readings that are not graded deliverables.
- All text must be PLAIN TEXT — no emoji or decorative symbols.
- If the document genuinely contains no graded deliverables at all, return { "course": ..., "needsInfo": false, "question": null, "items": [] }.`;

/** Defensively parse model JSON (strip ```json fences, match outer braces). */
function parseJson(raw: string): any {
  const stripped = raw.replace(/```json\s*/gi, "").replace(/```/g, "");
  const match = stripped.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : stripped);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ["assignment", "exam", "quiz", "reading"] as const;

/**
 * Extract assignment candidates from document text via a single model call
 * (no web search). Does NOT write to any store — the user confirms each item.
 */
export async function extractAssignments(
  text: string,
  supplement?: string
): Promise<ExtractionResult> {
  const note = supplement?.trim()
    ? `\nAdditional context / instructions from the user (use this to resolve dates or focus the extraction):
${supplement.trim()}\n`
    : "";

  const userMsg = `Today's date is ${todayStr()}.
${note}
Document text:
${text}

Extract the graded/required deliverables with due dates as JSON now.`;

  const raw = await chat([{ role: "user", content: userMsg }], EXTRACT_SYSTEM, 2048);

  let parsed: any;
  try {
    parsed = parseJson(raw);
  } catch {
    return { course: null, items: [], needsInfo: false, question: null };
  }

  const items: AssignmentCandidate[] = [];
  for (const it of parsed?.items ?? []) {
    if (!it?.title || typeof it.due !== "string" || !DATE_RE.test(it.due)) {
      continue;
    }
    const type = TYPES.includes(it.type) ? it.type : "assignment";
    items.push({
      title: String(it.title),
      due: it.due,
      type,
      note: typeof it.note === "string" && it.note.trim() ? it.note : undefined,
    });
  }

  const course =
    typeof parsed?.course === "string" && parsed.course.trim()
      ? parsed.course.trim()
      : null;
  const needsInfo = parsed?.needsInfo === true && items.length === 0;
  const question =
    typeof parsed?.question === "string" && parsed.question.trim()
      ? parsed.question.trim()
      : null;
  return { course, items, needsInfo, question };
}
