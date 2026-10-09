import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { db } from "./db";
import { addToCollection, createCollection, recordAttempt } from "./learning-service";
import { installPack, parsePackFile, parsePackText } from "./pack-service";
import { createProgressBackup, importProgressBackup, updateUserState } from "./progress-service";

const guidePath = process.env.HTTP_REFERENCE_PACK_PATH;
const expectedHash = "8e1f4a280030083c6ea8738b0f18154d0df67602d378c796be2a42ca16c4ac84";
afterEach(() => { cleanup(); localStorage.clear(); window.location.hash = ""; });

it.skipIf(!guidePath)("imports the frozen 360-question HTTP guide and preserves personal records across reinstall and restore", async () => {
  const bytes = readFileSync(guidePath!);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(expectedHash);
  const text = bytes.toString("utf8");
  // File.text is unavailable in jsdom; supply the exact bytes through its File API contract.
  const pack = await parsePackFile({ size: bytes.byteLength, text: async () => text } as File);
  expect(pack).toEqual(JSON.parse(text));
  expect(pack.schemaVersion).toBe(1);
  expect(pack.questions).toHaveLength(360);
  expect(pack.pack.questionCount).toBe(360);
  const question = pack.questions.find((q) => q.id === "10.1.23")!;
  const reference = question.revision!.references!.find((ref) => ref.url === "http://joschu.net/blog/kl-approx.html")!;
  expect(reference).toBeTruthy();

  await db.delete(); await db.open();
  await installPack(pack);
  const assertStoredPack = async () => {
    const stored = await db.questions.where("packId").equals(pack.pack.id).toArray();
    expect(stored.map(({ packId: _packId, ...q }) => q).sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([...pack.questions].sort((a, b) => a.id.localeCompare(b.id)));
  };
  await assertStoredPack();
  await updateUserState(pack.pack.id, question.id, { favorite: true, status: "mastered" });
  const collection = await createCollection("HTTP 来源学习记录");
  await addToCollection(collection.id, pack.pack.id, question.id);
  await recordAttempt({ packId: pack.pack.id, questionId: question.id, answer: "说明近似的假设与方差", usedHint: false,
    selfAssessment: "correct", mistakeReason: "", evidence: "本地验证记录" });
  const backup = await createProgressBackup();
  expect(backup.states).toHaveLength(1);
  expect(backup.collections).toHaveLength(1);
  expect(backup.members).toHaveLength(1);
  expect(backup.attempts).toHaveLength(1);
  expect(backup.schedules).toHaveLength(1);
  await installPack(parsePackText(text));
  expect({ ...await createProgressBackup(), exportedAt: "ignored" }).toEqual({ ...backup, exportedAt: "ignored" });

  await db.delete(); await db.open();
  await importProgressBackup(JSON.stringify(backup), "replace");
  await installPack(parsePackText(text));
  await assertStoredPack();
  expect({ ...await createProgressBackup(), exportedAt: "ignored" }).toEqual({ ...backup, exportedAt: "ignored" });

  window.location.hash = `/study?pack=${pack.pack.id}&question=${question.id}`;
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /拓展与追问/ }));
  const link = await screen.findByRole("link", { name: reference.title });
  expect(link).toHaveAttribute("href", reference.url);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noreferrer noopener");
  let clicked = false;
  link.addEventListener("click", (event) => { clicked = true; event.preventDefault(); }, { once: true });
  fireEvent.click(link);
  expect(clicked).toBe(true);
}, 30_000);
