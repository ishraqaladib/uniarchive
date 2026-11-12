import fs from "node:fs";
const source = fs.readFileSync("server/app.js", "utf8");
const routes = [
  ...source.matchAll(
    /app\.(get|post|put|patch|delete)\(\s*["'](\/api[^"']+)["']/g,
  ),
].map((m) => ({ method: m[1].toUpperCase(), path: m[2] }));
const course = {
  code: "CSE 323",
  name: "Web Programming Lab",
  credits: 3,
  semester: 6,
  department_id: "{{departmentId}}",
};
const doc = {
  title: "Lab routing notes",
  type: "Note",
  resource_kind: "Notes",
  year: 2026,
  course_id: "{{courseId}}",
};
const bodies = {
  "POST /api/auth/register": {
    name: "Your Name",
    email: "you@example.edu",
    password: "YourPassword123!",
    confirmPassword: "YourPassword123!",
  },
  "POST /api/auth/login": {
    email: "student@uniarchive.edu",
    password: "UniArchive123!",
  },
  "POST /api/auth/forgot-password": { email: "you@example.edu" },
  "POST /api/auth/resend-verification": { email: "you@example.edu" },
  "POST /api/auth/verify-email": { token: "{{token}}" },
  "POST /api/auth/reset-password": {
    token: "{{token}}",
    password: "NewPassword123!",
    confirmPassword: "NewPassword123!",
  },
  "POST /api/departments": { name: "Computer Science & Engineering" },
  "PUT /api/departments/:id": { name: "Computer Science & Engineering" },
  "POST /api/courses": course,
  "PUT /api/courses/:id": course,
  "PUT /api/documents/:id": doc,
  "PATCH /api/submissions/:id": {
    status: "Approved",
    reason: "Reviewed and approved.",
  },
  "POST /api/users": {
    name: "New Member",
    email: "new.member@example.edu",
    role: "Student",
  },
  "PATCH /api/users/:id": { role: "Moderator", status: "Active" },
  "DELETE /api/account": { password: "YourPassword123!" },
  "PATCH /api/settings": { maxUploadMb: 20 },
};
function variable(route) {
  if (route.includes("/departments/")) return "departmentId";
  if (route.includes("/courses/")) return "courseId";
  if (route.includes("/users/")) return "userId";
  return "documentId";
}
const group = {};
for (const r of routes) {
  const key = r.path.split("/")[2];
  const request = {
    method: r.method,
    header: [{ key: "X-UniArchive-Client", value: "web" }],
    url: "{{baseUrl}}" + r.path.replace(":id", "{{" + variable(r.path) + "}}"),
    description:
      "Session cookie is obtained from Login. See docs/API.md for permissions.",
  };
  const body = bodies[r.method + " " + r.path];
  if (body) {
    request.header.push({ key: "Content-Type", value: "application/json" });
    request.body = {
      mode: "raw",
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  if (r.method === "POST" && r.path === "/api/documents")
    request.body = {
      mode: "formdata",
      formdata: [
        ...Object.entries(doc).map(([key, value]) => ({
          key,
          value: String(value),
          type: "text",
        })),
        { key: "file", type: "file", src: [] },
      ],
    };
  (group[key] ??= []).push({
    name: r.method + " " + r.path,
    request,
    response: [],
  });
}
fs.writeFileSync(
  "docs/UniArchive.postman_collection.json",
  JSON.stringify(
    {
      info: {
        name: "UniArchive REST API",
        description:
          "University repository API. Login uses an HttpOnly session cookie saved by Postman. Writes require the included custom header.",
        schema:
          "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      variable: [
        { key: "baseUrl", value: "http://localhost:3000" },
        ...["courseId", "documentId", "departmentId", "userId", "token"].map(
          (key) => ({ key, value: "" }),
        ),
      ],
      item: Object.entries(group).map(([name, item]) => ({ name, item })),
    },
    null,
    2,
  ) + "\n",
);
function permission(r) {
  if (r.path.startsWith("/api/auth/"))
    return ["POST /api/auth/logout"].includes(r.method + " " + r.path)
      ? "Signed-in member"
      : "Public";
  if (
    ["/api/config", "/api/stats"].includes(r.path) ||
    (["/api/courses", "/api/departments"].includes(r.path) &&
      r.method === "GET")
  )
    return "Public";
  if (r.path.includes("/submissions/")) return "Admin / Moderator";
  if (
    r.path.startsWith("/api/users") ||
    r.path === "/api/settings" ||
    r.path.startsWith("/api/departments") ||
    r.path.startsWith("/api/courses")
  )
    return "Admin";
  if (r.path.includes("/file"))
    return "Signed-in; approved file, owner, or reviewer";
  if (
    r.path.startsWith("/api/documents/:id") &&
    ["PUT", "DELETE"].includes(r.method)
  )
    return "Uploader / Admin";
  return "Signed-in member";
}
fs.writeFileSync(
  "docs/API.md",
  `# UniArchive REST API\n\nAll paths are relative to the app origin. Responses use JSON except PDF files. Authentication is an HttpOnly session cookie; login sets it. Never place the JWT in localStorage. Mutating requests require X-UniArchive-Client: web; if an Origin header is present it must match APP_URL.\n\n| Method | Path | Permission |\n| --- | --- | --- |\n${routes.map((r) => "| " + r.method + " | " + r.path + " | " + permission(r) + " |").join("\n")}\n\n## Queries\n\n- GET /api/courses: q searches code and name. Department and semester filtering is performed by the interface.\n- GET /api/documents: mode=library (default), mine, saved, or queue. queue requires Admin/Moderator. Filters: course, type, year, kind, q. Queue status: Pending (default), Approved, Rejected.\n- GET /api/documents/:id/file: authenticated inline PDF; download=true sends an attachment and records a download.\n- DELETE /api/courses/:id: returns 409 if approved PDFs exist. Resubmit with confirm=true only after explicit confirmation.\n\n## Input and response behavior\n\nUse the Postman collection for request bodies. A PDF upload is multipart form-data with file, title, type, year, course_id, resource_kind. Maximum file size is configured by Admin between 1 and 20 MB. Types: Note, Slide, Past Paper. Resource categories: Notes, Assignment, Class Task, Summary. Document updates use JSON and return the document to Pending. Review accepts Approved or Rejected and an optional reason up to 500 characters.\n\nNew accounts must verify their university email. Public registration always assigns Student, regardless of extra request properties. Invitations also need password setup. Email tokens are SHA-256 hashed in the database and expire. Resetting a password and changing a role/status revokes existing sessions; logout revokes all the user’s sessions.\n\nErrors use {"error":"Human-readable message"}. Common statuses: 400 invalid input, 401 authentication required, 403 permission denied, 404 missing record, 409 duplicate/conflict/last-admin guard, 429 too many auth attempts. Success responses return an object or list; actions usually return {"message":"..."}. No live billing or payment mutation endpoint exists.\n`,
);
const db = fs.readFileSync("server/db.js", "utf8");
const schema = [...db.matchAll(/`(CREATE TABLE IF NOT EXISTS[^`]+)`/g)].map(
  (m) => m[1] + ";",
);
fs.writeFileSync(
  "docs/schema.mysql.sql",
  "-- UniArchive reference schema. The application initializes these tables automatically.\n-- Create/select your database before importing this file.\n\n" +
    schema.join("\n\n") +
    "\n",
);
