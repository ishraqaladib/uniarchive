import { test } from "node:test";
import assert from "node:assert/strict";
import { sendMail, assertMailConfiguration } from "../server/mail.js";
test("Brevo sends account mail over HTTPS and hides provider errors", async () => {
  const oldEnv = { ...process.env },
    originalFetch = globalThis.fetch;
  try {
    process.env.NODE_ENV = "production";
    process.env.EMAIL_PROVIDER = "brevo";
    process.env.BREVO_API_KEY = "test-private-api-key";
    process.env.EMAIL_FROM_ADDRESS = "verified@example.edu";
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, "https://api.brevo.com/v3/smtp/email");
      assert.equal(options.headers["api-key"], "test-private-api-key");
      const body = JSON.parse(options.body);
      assert.equal(body.sender.email, "verified@example.edu");
      assert.equal(body.to[0].email, "member@example.edu");
      assert.equal(body.textContent, "Private verification link");
      return { ok: true };
    };
    await sendMail({
      to: "member@example.edu",
      subject: "Verify",
      text: "Private verification link",
    });
    assert.equal(calls, 1);
    globalThis.fetch = async () => ({ ok: false, status: 401 });
    await assert.rejects(
      sendMail({
        to: "member@example.edu",
        subject: "Verify",
        text: "Private verification link",
      }),
      (e) => e.status === 503 && !e.message.includes("api-key"),
    );
    delete process.env.BREVO_API_KEY;
    assert.throws(assertMailConfiguration, /BREVO_API_KEY/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env))
      if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});
