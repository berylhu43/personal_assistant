import { open } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { chat } from "./anthropic";

// pdf.js runs its parser in a Web Worker; point it at the bundled worker.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_CHARS = 12_000; // cap text sent to the model
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

const EXTRACT_SYSTEM = `You read the text of a course syllabus or assignment document and extract ONLY concrete graded/required deliverables that have a DUE DATE.

Return ONLY JSON of this exact shape (no prose, no markdown fences):
{ "course": "CS101", "items": [ { "title": "Essay 1", "due": "YYYY-MM-DD", "type": "assignment", "note": "optional short detail" } ] }

Rules:
- course: the course code or name if clearly identifiable, otherwise null.
- items: each must be a real, required, graded deliverable WITH a due date.
- title: short and specific (e.g. "Problem Set 3", "Midterm Exam", "Reading Response 2").
- due: ABSOLUTE date YYYY-MM-DD. Resolve relative dates ("Week 3 Friday", "by Friday", "end of week 5") to absolute dates using today's date as the reference point. If an item has no determinable due date, OMIT it.
- type: one of "assignment", "exam", "quiz", "reading".
- note: optional short detail (weight, page count) — omit if nothing useful.
- IGNORE office hours, grading policies, course descriptions, recommended/optional readings without deadlines, and anything without a concrete due date.
- All text must be PLAIN TEXT — no emoji or decorative symbols.
- If nothing qualifies, return { "course": null, "items": [] }.`;

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
  text: string
): Promise<ExtractionResult> {
  const userMsg = `Today's date is ${todayStr()}.

Document text:
${text}

Extract the graded/required deliverables with due dates as JSON now.`;

  const raw = await chat([{ role: "user", content: userMsg }], EXTRACT_SYSTEM, 2048);

  let parsed: any;
  try {
    parsed = parseJson(raw);
  } catch {
    return { course: null, items: [] };
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
  return { course, items };
}
