import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
const require = createRequire(import.meta.url);
test("course migration preserves IDs, references and values while allowing unknown placement", async () => {
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "uniarchive-course-migration-"),
  );
  process.env.DATA_DIR = temp;
  process.env.DB_CLIENT = "sqlite";
  process.env.NODE_ENV = "test";
  const SQL = await initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
  });
  const legacy = new SQL.Database();
  legacy.run(
    "CREATE TABLE departments(id VARCHAR(36) PRIMARY KEY,name VARCHAR(120) NOT NULL UNIQUE)",
  );
  legacy.run(
    "CREATE TABLE courses(id VARCHAR(36) PRIMARY KEY,code VARCHAR(30) NOT NULL UNIQUE,name VARCHAR(150) NOT NULL,credits DECIMAL(4,1) NOT NULL,semester INTEGER NOT NULL,department_id VARCHAR(36) NOT NULL,FOREIGN KEY(department_id) REFERENCES departments(id))",
  );
  legacy.run(
    "CREATE TABLE existing_file_reference(id TEXT PRIMARY KEY,course_id VARCHAR(36) NOT NULL,FOREIGN KEY(course_id) REFERENCES courses(id))",
  );
  legacy.run("INSERT INTO departments VALUES('d','CSE')");
  legacy.run(
    "INSERT INTO courses VALUES('c','CSE 323','Web Programming Lab',3,6,'d')",
  );
  legacy.run("INSERT INTO existing_file_reference VALUES('file','c')");
  await fs.writeFile(
    path.join(temp, "uniarchive.sqlite"),
    Buffer.from(legacy.export()),
  );
  legacy.close();
  const { openDatabase } = await import("../server/db.js");
  let db;
  try {
    db = await openDatabase();
    const [old] = await db.query("SELECT * FROM courses WHERE id=?", ["c"]);
    assert.equal(old.code, "CSE 323");
    assert.equal(old.credits, 3);
    assert.equal(old.semester, 6);
    assert.equal(
      (await db.query("SELECT course_id FROM existing_file_reference"))[0]
        .course_id,
      "c",
    );
    assert.deepEqual(await db.query("PRAGMA foreign_key_check"), []);
    await db.query(
      "INSERT INTO courses(id,code,name,credits,semester,department_id) VALUES(?,?,?,?,?,?)",
      ["new", "CSE 125", "Discrete Mathematics", null, null, "d"],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO courses(id,code,name,department_id) VALUES(?,?,?,?)",
        ["bad", "BAD 1", "Bad", "missing"],
      ),
      /FOREIGN KEY/,
    );
    await db.close();
    db = await openDatabase();
    const [unknown] = await db.query(
      "SELECT credits,semester FROM courses WHERE id=?",
      ["new"],
    );
    assert.deepEqual(unknown, { credits: null, semester: null });
    assert.deepEqual(await db.query("PRAGMA foreign_key_check"), []);
  } finally {
    await db?.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
