import { execFile } from "node:child_process";
import { promisify } from "node:util";
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import mysql from "mysql2/promise";
const require = createRequire(import.meta.url);
export const dataDir = path.resolve(process.env.DATA_DIR || ".data");
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
export const uploadsDir = path.join(dataDir, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
export const now = () => new Date().toISOString();
export async function openDatabase() {
  let sqlite, pool;
  const filename = path.join(dataDir, "uniarchive.sqlite");
  if (process.env.DB_CLIENT === "mysql")
    pool = await mysql.createPool({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT || 3306),
      database: process.env.MYSQL_DATABASE || "uniarchive",
      user: process.env.MYSQL_USER || "uniarchive",
      password: process.env.MYSQL_PASSWORD,
      connectionLimit: 3,
      connectTimeout: 30000,
      enableKeepAlive: true,
      maxIdle: 1,
      idleTimeout: 60000,
      ...(process.env.MYSQL_SSL === "true"
        ? {
            ssl: {
              rejectUnauthorized: true,
              verifyIdentity: true,
              ...(process.env.MYSQL_SSL_CA
                ? { ca: process.env.MYSQL_SSL_CA.replace(/\\n/g, "\n") }
                : {}),
            },
          }
        : {}),
    });
  else {
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    sqlite = new SQL.Database(
      fs.existsSync(filename) ? fs.readFileSync(filename) : undefined,
    );
    sqlite.run("PRAGMA foreign_keys=ON");
  }
  let queue = Promise.resolve();
  const lock = async (fn) => {
    const previous = queue;
    let unlock;
    queue = new Promise((r) => (unlock = r));
    await previous;
    try {
      return await fn();
    } finally {
      unlock();
    }
  };
  function persist() {
    if (sqlite) {
      const tmp = filename + ".tmp";
      const bytes = Buffer.from(sqlite.export());
      sqlite.run("PRAGMA foreign_keys=ON");
      fs.writeFileSync(tmp, bytes, { mode: 0o600 });
      fs.renameSync(tmp, filename);
    }
  }
  async function raw(sql, params = [], conn = pool) {
    if (conn) {
      const [rows] = await conn.execute(sql, params);
      return Array.isArray(rows) ? rows : { changes: rows.affectedRows };
    }
    const stmt = sqlite.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return /^\s*(SELECT|PRAGMA|WITH)/i.test(sql)
        ? rows
        : { changes: sqlite.getRowsModified() };
    } finally {
      stmt.free();
    }
  }
  const db = {
    dialect: pool ? "mysql" : "sqlite",
    query: (sql, params = []) =>
      lock(async () => {
        const result = await raw(sql, params);
        if (!/^\s*(SELECT|PRAGMA|WITH)/i.test(sql)) persist();
        return result;
      }),
    transaction: (fn) =>
      lock(async () => {
        let conn = pool ? await pool.getConnection() : null;
        try {
          if (conn) await conn.beginTransaction();
          else sqlite.run("BEGIN");
          const result = await fn({
            dialect: pool ? "mysql" : "sqlite",
            query: (sql, params = []) => raw(sql, params, conn),
          });
          if (conn) await conn.commit();
          else {
            sqlite.run("COMMIT");
            persist();
          }
          return result;
        } catch (e) {
          if (conn) await conn.rollback();
          else sqlite.run("ROLLBACK");
          throw e;
        } finally {
          conn?.release();
        }
      }),
    close: async () => {
      if (pool) await pool.end();
      else sqlite.close();
    },
    snapshot: (target) =>
      lock(async () => {
        await fs.promises.mkdir(target, { recursive: true, mode: 0o700 });
        if (sqlite) {
          const bytes = Buffer.from(sqlite.export());
          // sql.js export reopens its connection; restore checks before I/O.
          sqlite.run("PRAGMA foreign_keys=ON");
          await fs.promises.writeFile(
            path.join(target, "uniarchive.sqlite"),
            bytes,
            { mode: 0o600 },
          );
        } else {
          const { stdout } = await promisify(execFile)(
            "mysqldump",
            [
              "--single-transaction",
              "--no-tablespaces",
              "-h",
              process.env.MYSQL_HOST || "127.0.0.1",
              "-P",
              process.env.MYSQL_PORT || "3306",
              "-u",
              process.env.MYSQL_USER || "uniarchive",
              process.env.MYSQL_DATABASE || "uniarchive",
            ],
            {
              env: {
                ...process.env,
                MYSQL_PWD: process.env.MYSQL_PASSWORD || "",
              },
              maxBuffer: 100 * 1024 * 1024,
            },
          );
          await fs.promises.writeFile(
            path.join(target, "database.sql"),
            stdout,
            { mode: 0o600 },
          );
        }
        await fs.promises.cp(uploadsDir, path.join(target, "uploads"), {
          recursive: true,
        });
        const cloudFiles = await raw(
          "SELECT id,file_name,original_name FROM documents WHERE storage_provider=?",
          ["google-drive"],
        );
        await fs.promises.writeFile(
          path.join(target, "cloud-files.json"),
          JSON.stringify(cloudFiles, null, 2),
          { mode: 0o600 },
        );
      }),
  };
  for (const sql of schema) await db.query(sql);
  const documentColumns = pool
    ? await db.query("SHOW COLUMNS FROM documents")
    : await db.query("PRAGMA table_info(documents)");
  if (
    !documentColumns.some(
      (column) => (column.Field || column.name) === "storage_provider",
    )
  ) {
    await db.query(
      "ALTER TABLE documents ADD COLUMN storage_provider VARCHAR(20) NOT NULL DEFAULT 'local'",
    );
  }
  const courseColumns = pool
    ? await db.query("SHOW COLUMNS FROM courses")
    : await db.query("PRAGMA table_info(courses)");
  for (const [column, type] of [
    ["catalog_status", "VARCHAR(20)"],
    ["catalog_sources", "TEXT"],
    ["catalog_note", "TEXT"],
  ]) {
    if (!courseColumns.some((c) => (c.Field || c.name) === column)) {
      try {
        await db.query(`ALTER TABLE courses ADD COLUMN ${column} ${type}`);
      } catch (e) {
        if (
          e.code !== "ER_DUP_FIELDNAME" &&
          !/duplicate column name/i.test(e.message)
        )
          throw e;
      }
    }
  }
  if (
    pool &&
    courseColumns.some(
      (c) => ["credits", "semester"].includes(c.Field) && c.Null === "NO",
    )
  ) {
    await db.query(
      "ALTER TABLE courses MODIFY credits DECIMAL(4,1) NULL, MODIFY semester INTEGER NULL",
    );
  } else if (
    sqlite &&
    courseColumns.some(
      (c) => ["credits", "semester"].includes(c.name) && c.notnull,
    )
  ) {
    // SQLite cannot relax NOT NULL in place. Rebuild without changing course IDs or references.
    sqlite.run("PRAGMA foreign_keys=OFF");
    try {
      sqlite.run("BEGIN");
      sqlite.run(
        schema
          .find((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS courses ("))
          .replace("courses (", "courses_nullable ("),
      );
      const columns =
        "id,code,name,credits,semester,department_id,catalog_status,catalog_sources,catalog_note";
      sqlite.run(
        `INSERT INTO courses_nullable (${columns}) SELECT ${columns} FROM courses`,
      );
      sqlite.run("DROP TABLE courses");
      sqlite.run("ALTER TABLE courses_nullable RENAME TO courses");
      if (sqlite.exec("PRAGMA foreign_key_check")[0]?.values.length)
        throw new Error(
          "Course migration failed referential integrity checks.",
        );
      sqlite.run("COMMIT");
    } catch (e) {
      sqlite.run("ROLLBACK");
      throw e;
    } finally {
      sqlite.run("PRAGMA foreign_keys=ON");
    }
    persist();
  }
  if (!(await db.query("SELECT * FROM settings WHERE id=?", ["main"])).length)
    await db.query("INSERT INTO settings (id,max_upload_mb) VALUES (?,?)", [
      "main",
      20,
    ]);
  return db;
}
const schema = [
  `CREATE TABLE IF NOT EXISTS file_cleanup (id VARCHAR(36) PRIMARY KEY,file_name VARCHAR(255) NOT NULL,storage_provider VARCHAR(20) NOT NULL,created_at VARCHAR(30) NOT NULL,attempts INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS users (id VARCHAR(36) PRIMARY KEY,name VARCHAR(100) NOT NULL,email VARCHAR(254) NOT NULL UNIQUE,password_hash VARCHAR(255) NOT NULL,role VARCHAR(20) NOT NULL,status VARCHAR(20) NOT NULL,verified INTEGER NOT NULL DEFAULT 0,session_version INTEGER NOT NULL DEFAULT 0,created_at VARCHAR(30) NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS user_avatars (user_id VARCHAR(36) PRIMARY KEY,data MEDIUMBLOB NOT NULL,mime_type VARCHAR(30) NOT NULL,version VARCHAR(36) NOT NULL,FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS upload_sessions (id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36) NOT NULL,metadata TEXT NOT NULL,total_bytes INTEGER NOT NULL,expires_at VARCHAR(30) NOT NULL,FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS upload_chunks (upload_id VARCHAR(36) NOT NULL,chunk_index INTEGER NOT NULL,data MEDIUMBLOB NOT NULL,PRIMARY KEY(upload_id,chunk_index),FOREIGN KEY (upload_id) REFERENCES upload_sessions(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS departments (id VARCHAR(36) PRIMARY KEY,name VARCHAR(120) NOT NULL UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS courses (id VARCHAR(36) PRIMARY KEY,code VARCHAR(30) NOT NULL UNIQUE,name VARCHAR(150) NOT NULL,credits DECIMAL(4,1),semester INTEGER,department_id VARCHAR(36) NOT NULL,catalog_status VARCHAR(20),catalog_sources TEXT,catalog_note TEXT,FOREIGN KEY (department_id) REFERENCES departments(id))`,
  `CREATE TABLE IF NOT EXISTS documents (id VARCHAR(36) PRIMARY KEY,title VARCHAR(180) NOT NULL,type VARCHAR(20) NOT NULL,resource_kind VARCHAR(20) NOT NULL,year INTEGER NOT NULL,course_id VARCHAR(36) NOT NULL,uploader_id VARCHAR(36) NOT NULL,file_name VARCHAR(255) NOT NULL,storage_provider VARCHAR(20) NOT NULL DEFAULT 'local',original_name VARCHAR(255) NOT NULL,size_bytes INTEGER NOT NULL,created_at VARCHAR(30) NOT NULL,FOREIGN KEY (course_id) REFERENCES courses(id),FOREIGN KEY (uploader_id) REFERENCES users(id))`,
  `CREATE TABLE IF NOT EXISTS submissions (id VARCHAR(36) PRIMARY KEY,document_id VARCHAR(36) NOT NULL UNIQUE,status VARCHAR(20) NOT NULL,reviewed_by VARCHAR(36),reviewed_at VARCHAR(30),reason VARCHAR(500),FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL)`,
  `CREATE TABLE IF NOT EXISTS downloads (id VARCHAR(36) PRIMARY KEY,document_id VARCHAR(36) NOT NULL,user_id VARCHAR(36),created_at VARCHAR(30) NOT NULL,FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL)`,
  `CREATE TABLE IF NOT EXISTS payments (id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36) NOT NULL,plan VARCHAR(20) NOT NULL,amount DECIMAL(8,2) NOT NULL,status VARCHAR(20) NOT NULL,created_at VARCHAR(30) NOT NULL,FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS tokens (id VARCHAR(64) PRIMARY KEY,user_id VARCHAR(36) NOT NULL,kind VARCHAR(20) NOT NULL,expires_at VARCHAR(30) NOT NULL,FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS settings (id VARCHAR(20) PRIMARY KEY,max_upload_mb INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS collections (id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36) NOT NULL,document_id VARCHAR(36) NOT NULL,UNIQUE(user_id,document_id),FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE)`,
];
