import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactCredentialSecrets, redactCredentialString } from "./credentials";
import { scrubAuditMetadata, scrubTelemetry } from "./scrub";
import { sentryScrubbingHooks } from "./sentry";

describe("provider diagnostic redaction regressions", () => {
  const secret = "synthetic-provider-credential";

  it("redacts every duplicate JSON member, including shadowed nested credentials", () => {
    const fixtures = [
      `{"response":"token=${secret}","response":"ok","status":502}`,
      `{"response":{"password":"${secret}"},"response":{},"status":502}`,
      `{"response":[{"mnemonic":"${secret}"}],"response":[],"status":502}`,
      `{"response":"${encodeURIComponent(`token=${secret}`)}","response":false,"status":502}`,
      `{"response":"token=${secret}","res\\u0070onse":null,"status":502}`,
      `{"password":"${secret}","password":"ok","status":502}`,
    ];

    for (const body of fixtures) {
      for (const redacted of [
        redactCredentialString(body),
        redactCredentialSecrets({ body }).body,
        scrubTelemetry({ body }).body,
        scrubAuditMetadata({ body }).body,
      ]) {
        assert.ok(!redacted.includes(secret), redacted);
        assert.ok(redacted.includes('"status":502'), redacted);
        assert.doesNotThrow(() => JSON.parse(redacted));
      }
    }
  });

  it("preserves duplicate members and their formatting when replacing a credential", () => {
    assert.equal(
      redactCredentialString(`{ "response": "token=${secret}", "response": "ok", "status": 502 }`),
      '{ "response": "token=[REDACTED]", "response": "ok", "status": 502 }'
    );
  });

  it("preserves exact numeric lexemes beside escaped and embedded credentials", () => {
    const credentials = [
      `"\\u0070assword":"${secret}"`,
      `"note":"token=${secret}"`,
      `"url":"https://example.test/?state=${encodeURIComponent(`token=${secret}`)}"`,
      `"response":"{\\"password\\":\\"${secret}\\"}"`,
    ];
    const numbers = [
      "9007199254740993",
      "12345678901234567890",
      "1.2345678901234567e+30",
      "1e400",
      "-0",
      "0.00000000000000000001",
    ];

    for (const credential of credentials) {
      for (const number of numbers) {
        const body = `{ "amount": ${number}, ${credential}, "status": 502 }`;
        for (const redacted of [redactCredentialString(body), scrubTelemetry({ body }).body]) {
          assert.ok(!redacted.includes(secret), redacted);
          assert.ok(redacted.includes(`"amount": ${number}`), redacted);
          assert.ok(redacted.includes('"status": 502'), redacted);
          assert.doesNotThrow(() => JSON.parse(redacted));
        }
      }
    }
  });

  it("keeps JSON escapes and numeric formatting outside the redacted string", () => {
    const body = `{ "amount": 1e400, "password" : "${secret}", "note": "\\u0061" }`;

    assert.equal(
      redactCredentialString(body),
      '{ "amount": 1e400, "password" : "[REDACTED]", "note": "\\u0061" }'
    );
  });

  it("redacts credentials in property names without dropping their separators or values", () => {
    assert.equal(
      redactCredentialString(`{ "token=${secret}/diagnostic" : "denied", "amount": 1e400 }`),
      '{ "token=[REDACTED]" : "denied", "amount": 1e400 }'
    );
  });

  it("masks deeply nested JSON without changing adjacent numeric diagnostics", () => {
    const body = `{"amount":9007199254740993,"response":${"[".repeat(20)}"${secret}"${"]".repeat(20)}}`;
    const redacted = redactCredentialString(body);

    assert.ok(!redacted.includes(secret), redacted);
    assert.ok(redacted.includes('"amount":9007199254740993'), redacted);
    assert.doesNotThrow(() => JSON.parse(redacted));
  });

  it("removes shadowed credentials from Sentry exception diagnostics and keeps exact ids", () => {
    const body = `{"response":"token=${secret}","response":"ok","requestId":9007199254740993}`;
    const event = sentryScrubbingHooks.beforeSend({
      event_id: "evt_1",
      exception: { values: [{ type: "ProviderError", value: body }] },
    });

    assert.ok(event);
    assert.equal(event.event_id, "evt_1");
    assert.equal(event.exception.values[0].type, "ProviderError");
    assert.equal(
      event.exception.values[0].value,
      '{"response":"token=[REDACTED]","response":"ok","requestId":9007199254740993}'
    );
  });

  it("retains diagnostics at the size limit and masks larger strings whole", () => {
    const limit = 64 * 1024;
    const suffix = ` password=${secret}`;
    const body = "x".repeat(limit - suffix.length) + suffix;

    assert.equal(
      redactCredentialString(body),
      `${"x".repeat(limit - suffix.length)} password=[REDACTED]`
    );
    for (const oversized of [
      `${body}x`,
      `password=${secret} ${"x".repeat(limit)}`,
      `${"x".repeat(limit)} password=${secret}`,
      `{"note":"${"x".repeat(limit)}","password":"${secret}"}`,
      "a=b ".repeat((5 * 1024 * 1024) / 4),
      "a://".repeat((5 * 1024 * 1024) / 4),
    ]) {
      assert.equal(redactCredentialString(oversized), "[REDACTED]");
      assert.deepEqual(scrubTelemetry({ body: oversized, status: 502 }), {
        body: "[REDACTED]",
        status: 502,
      });
    }
  });
});
