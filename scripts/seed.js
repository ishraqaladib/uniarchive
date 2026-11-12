import { fileURLToPath } from "node:url";
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { openDatabase, now, uploadsDir } from "../server/db.js";
export const demoUsers = [
  {
    name: "Tayeba Ahmed Chowdhury",
    email: "admin@uniarchive.edu",
    role: "Admin",
  },
  {
    name: "MD Ishraq Al Adib",
    email: "moderator@uniarchive.edu",
    role: "Moderator",
  },
  { name: "Demo Student", email: "student@uniarchive.edu", role: "Student" },
];
export async function seed(db) {
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "Demo seeding is disabled in production. Use npm run admin:create.",
    );
  const password = process.env.DEMO_PASSWORD || "UniArchive123!";
  for (const u of demoUsers) {
    const [existing] = await db.query("SELECT id FROM users WHERE email=?", [
      u.email,
    ]);
    if (!existing)
      await db.query(
        "INSERT INTO users (id,name,email,password_hash,role,status,verified,session_version,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          crypto.randomUUID(),
          u.name,
          u.email,
          await bcrypt.hash(password, 12),
          u.role,
          "Active",
          1,
          0,
          now(),
        ],
      );
  }
  const departmentNames = [
    "Computer Science & Engineering",
    "Electrical & Electronic Engineering",
    "Business Administration",
  ];
  for (const name of departmentNames)
    if (
      !(await db.query("SELECT id FROM departments WHERE name=?", [name]))
        .length
    )
      await db.query("INSERT INTO departments (id,name) VALUES (?,?)", [
        crypto.randomUUID(),
        name,
      ]);
  const [dep] = await db.query("SELECT id FROM departments WHERE name=?", [
    departmentNames[0],
  ]);
  for (const [code, name, semester] of [
    ["CSE 323", "Web Programming Lab", 6],
    ["CSE 327", "Theory of Computation", 6],
    ["CSE 421", "Artificial Intelligence", 8],
    ["CSE 221", "Data Structures", 4],
    ["CSE 311", "Database Management Systems", 5],
    ["CSE 231", "Discrete Mathematics", 4],
  ])
    if (!(await db.query("SELECT id FROM courses WHERE code=?", [code])).length)
      await db.query(
        "INSERT INTO courses (id,code,name,credits,semester,department_id) VALUES (?,?,?,?,?,?)",
        [crypto.randomUUID(), code, name, 3, semester, dep.id],
      );
  const [student] = await db.query("SELECT id FROM users WHERE email=?", [
    "student@uniarchive.edu",
  ]);
  const [admin] = await db.query("SELECT id FROM users WHERE email=?", [
    "admin@uniarchive.edu",
  ]);
  for (const [code, title, type, year, kind, status] of [
    [
      "CSE 323",
      "Lab 4: Express routing notes",
      "Note",
      2026,
      "Notes",
      "Approved",
    ],
    ["CSE 323", "Midterm past paper", "Past Paper", 2025, "Notes", "Approved"],
    ["CSE 323", "Chapter 3 slides", "Slide", 2026, "Notes", "Pending"],
    [
      "CSE 327",
      "Finite automata revision summary",
      "Note",
      2026,
      "Summary",
      "Approved",
    ],
    [
      "CSE 421",
      "Search algorithms: class practice",
      "Note",
      2026,
      "Class Task",
      "Approved",
    ],
    [
      "CSE 323",
      "Build a REST API: assignment brief",
      "Note",
      2026,
      "Assignment",
      "Approved",
    ],
  ]) {
    if (
      (await db.query("SELECT id FROM documents WHERE title=?", [title])).length
    )
      continue;
    const [course] = await db.query("SELECT id FROM courses WHERE code=?", [
      code,
    ]);
    const id = crypto.randomUUID();
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("UniArchive | Sample course material", {
      x: 48,
      y: 780,
      size: 12,
      font,
      color: rgb(0.05, 0.45, 0.45),
    });
    page.drawText(title, { x: 48, y: 735, size: 19, font });
    page.drawText(`${code} | ${type} | ${year}`, {
      x: 48,
      y: 700,
      size: 12,
      font,
    });
    const lines = [
      "This is an illustrative PDF generated for the UniArchive course project.",
      "It is not an actual university exam or lecture resource.",
      "",
      "Use this file to test previewing, downloading, saving and moderation.",
      "Replace it with approved course material when using the repository.",
    ];
    lines.forEach((line, i) =>
      page.drawText(line, { x: 48, y: 650 - i * 23, size: 11, font }),
    );
    await fs.writeFile(path.join(uploadsDir, id + ".pdf"), await pdf.save());
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO documents (id,title,type,resource_kind,year,course_id,uploader_id,file_name,original_name,size_bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          title,
          type,
          kind,
          year,
          course.id,
          student.id,
          id + ".pdf",
          title + ".pdf",
          (await fs.stat(path.join(uploadsDir, id + ".pdf"))).size,
          now(),
        ],
      );
      await tx.query(
        "INSERT INTO submissions (id,document_id,status,reviewed_by,reviewed_at) VALUES (?,?,?,?,?)",
        [
          crypto.randomUUID(),
          id,
          status,
          status === "Approved" ? admin.id : null,
          status === "Approved" ? now() : null,
        ],
      );
    });
  }
  if (
    !(await db.query("SELECT id FROM payments WHERE user_id=?", [student.id]))
      .length
  )
    for (const [date, status] of [
      ["2026-09-01T12:00:00.000Z", "Paid"],
      ["2026-10-01T12:00:00.000Z", "Paid"],
      ["2026-11-01T12:00:00.000Z", "Pending"],
    ])
      await db.query(
        "INSERT INTO payments (id,user_id,plan,amount,status,created_at) VALUES (?,?,?,?,?,?)",
        [crypto.randomUUID(), student.id, "Pro", 5, status, date],
      );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = await openDatabase();
  try {
    await seed(db);
    console.log(
      "Demo ready. Accounts: admin@uniarchive.edu, moderator@uniarchive.edu, student@uniarchive.edu",
    );
    console.log(
      "Password for demo accounts: DEMO_PASSWORD from your environment, or UniArchive123! by default.",
    );
  } finally {
    await db.close();
  }
}
