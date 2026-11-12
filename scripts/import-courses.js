import "dotenv/config";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { openDatabase, dataDir, now } from "../server/db.js";
import path from "node:path";

// Read a reviewed JSON array. Without --apply this only reports the proposed data changes.
const filename = process.argv[2];
if (!filename)
  throw new Error("Supply a JSON course register and optionally --apply.");
const records = JSON.parse(await fs.readFile(filename, "utf8"));
const normalize = (code) => code.toUpperCase().replace(/[\s-]+/g, "");
if (!Array.isArray(records) || !records.length || records.length > 1000)
  throw new Error("Invalid course register.");
const keys = new Set();
for (const row of records) {
  if (
    !row.course_code?.trim() ||
    row.course_code.length > 30 ||
    !row.course_title?.trim() ||
    row.course_title.length > 150 ||
    !["Summer 2026", "Spring 2025"].includes(row.source_term)
  )
    throw new Error("A course record is incomplete or unsupported.");
  const urls = row.source_url?.split(" | ") || [];
  if (
    !urls.length ||
    urls.some((url) => new URL(url).origin !== "https://metrouni.edu.bd")
  )
    throw new Error("A course source must link to Metropolitan University.");
  const key = normalize(row.course_code);
  if (keys.has(key)) throw new Error("Duplicate course code in the import.");
  keys.add(key);
}
const db = await openDatabase();
try {
  const existing = await db.query("SELECT * FROM courses");
  const map = new Map(
    existing.map((course) => [normalize(course.code), course]),
  );
  const conflicts = records.filter(
    (row) =>
      map.has(normalize(row.course_code)) &&
      map.get(normalize(row.course_code)).name.trim().toLowerCase() !==
        row.course_title.trim().toLowerCase(),
  );
  if (conflicts.length)
    throw new Error(
      "Existing course names differ for: " +
        conflicts.map((row) => row.course_code).join(", "),
    );
  const retained = records.filter((row) =>
    map.has(normalize(row.course_code)),
  ).length;
  const report = {
    registerCount: records.length,
    toAdd: records.length - retained,
    alreadyPresent: retained,
    earlierEvidence: records.filter((row) => row.source_term === "Spring 2025")
      .length,
    newCreditsAndSemesters: null,
  };
  if (!process.argv.includes("--apply"))
    console.log(JSON.stringify({ ...report, applied: false }));
  else {
    // Preserve a small metadata-only recovery record before changing the catalog.
    await fs.writeFile(
      path.join(dataDir, "course-import-before-" + Date.now() + ".json"),
      JSON.stringify(existing, null, 2),
      { mode: 0o600 },
    );
    await db.transaction(async (tx) => {
      let [department] = await tx.query(
        "SELECT id FROM departments WHERE name=?",
        ["Computer Science & Engineering"],
      );
      if (!department) {
        department = { id: crypto.randomUUID() };
        await tx.query("INSERT INTO departments(id,name) VALUES(?,?)", [
          department.id,
          "Computer Science & Engineering",
        ]);
      }
      for (const row of records) {
        const old = map.get(normalize(row.course_code));
        const status =
          row.source_term === "Summer 2026"
            ? "2026 routine"
            : "Earlier evidence";
        const note = [
          row.verification_status,
          row.notes,
          row.same_title_other_codes
            ? `Other codes with the same title: ${row.same_title_other_codes}. Course equivalence is unconfirmed.`
            : "",
        ]
          .filter(Boolean)
          .join(" ");
        if (old)
          await tx.query(
            "UPDATE courses SET catalog_status=?,catalog_sources=?,catalog_note=? WHERE id=?",
            [status, row.source_url, note, old.id],
          );
        else
          await tx.query(
            "INSERT INTO courses(id,code,name,credits,semester,department_id,catalog_status,catalog_sources,catalog_note) VALUES(?,?,?,?,?,?,?,?,?)",
            [
              crypto.randomUUID(),
              row.course_code,
              row.course_title,
              null,
              null,
              department.id,
              status,
              row.source_url,
              note,
            ],
          );
      }
    });
    const after = await db.query("SELECT id,code,catalog_status FROM courses");
    const counts = new Map();
    for (const row of after) {
      const key = normalize(row.code);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    if (records.some((row) => counts.get(normalize(row.course_code)) !== 1))
      throw new Error("Import verification failed.");
    const result = {
      ...report,
      applied: true,
      totalCourses: after.length,
      allRegisterCodesPresent: true,
      verifiedAt: now(),
    };
    await fs.writeFile(
      path.join(dataDir, "course-import-result.json"),
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(result));
  }
} finally {
  await db.close();
}
