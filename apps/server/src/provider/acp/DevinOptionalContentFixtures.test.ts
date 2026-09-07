import { describe, expect, it } from "vite-plus/test";

const MAX_CAPTURE_RECORD_BYTES = 512;
const MAX_CAPTURE_RECORDS = 32;

export type DevinOptionalContentClassification =
  | "ordinary text"
  | "resource link"
  | "embedded resource"
  | "elicitation"
  | "child-agent update"
  | "unsupported";

export interface DevinSanitizedAcpCapture {
  readonly method: "session/update" | "session/elicitation" | "unknown";
  readonly updateType?: string;
  readonly contentType?: string;
  readonly classification: DevinOptionalContentClassification;
  readonly reason?: "redacted-size";
}

export const DEVIN_OPTIONAL_CONTENT_UNSUPPORTED_FIXTURE = {
  status: "unsupported",
  reason: "not-emitted-by-installed-devin-cli",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeTag(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(value)
    ? value
    : undefined;
}

function classifyContent(
  method: DevinSanitizedAcpCapture["method"],
  updateType: string | undefined,
  contentType: string | undefined,
): DevinOptionalContentClassification {
  if (method === "session/elicitation") return "elicitation";
  if (updateType && /(?:child|sub)agent|agent[_-]spawn/iu.test(updateType)) {
    return "child-agent update";
  }
  switch (contentType) {
    case "text":
      return "ordinary text";
    case "resource_link":
      return "resource link";
    case "resource":
      return "embedded resource";
    default:
      return "unsupported";
  }
}

function boundedRecord(record: DevinSanitizedAcpCapture): DevinSanitizedAcpCapture {
  const encoded = new TextEncoder().encode(JSON.stringify(record));
  return encoded.byteLength <= MAX_CAPTURE_RECORD_BYTES
    ? record
    : { method: "unknown", classification: "unsupported", reason: "redacted-size" };
}

export function captureDevinAcpUpdate(event: unknown): DevinSanitizedAcpCapture | undefined {
  if (!isRecord(event) || event.direction !== "incoming" || event.stage !== "decoded") {
    return undefined;
  }

  const messages = Array.isArray(event.payload) ? event.payload : [event.payload];
  const message = messages.find(isRecord);
  if (!message) return undefined;

  const method =
    message.tag === "session/update"
      ? "session/update"
      : message.tag === "session/elicitation"
        ? "session/elicitation"
        : "unknown";
  if (method === "unknown") return undefined;

  const payload = isRecord(message.payload) ? message.payload : undefined;
  const update = payload && isRecord(payload.update) ? payload.update : undefined;
  const oversizedField =
    (typeof update?.sessionUpdate === "string" && update.sessionUpdate.length > 64) ||
    (isRecord(update?.content) &&
      typeof update.content.type === "string" &&
      update.content.type.length > 64);
  if (oversizedField) {
    return { method: "unknown", classification: "unsupported", reason: "redacted-size" };
  }
  const updateType = safeTag(update?.sessionUpdate);
  const content = update && isRecord(update.content) ? update.content : undefined;
  const contentType = safeTag(content?.type);
  return boundedRecord({
    method,
    ...(updateType ? { updateType } : {}),
    ...(contentType ? { contentType } : {}),
    classification: classifyContent(method, updateType, contentType),
  });
}

export function makeDevinAcpCapture() {
  const records: DevinSanitizedAcpCapture[] = [];
  return {
    write(event: unknown): void {
      const record = captureDevinAcpUpdate(event);
      if (record && records.length < MAX_CAPTURE_RECORDS) records.push(record);
    },
    records(): ReadonlyArray<DevinSanitizedAcpCapture> {
      return records.slice();
    },
  };
}

describe("Devin sanitized optional ACP fixtures", () => {
  it("redacts prompts, credentials, paths, environment values, and blobs", () => {
    const capture = makeDevinAcpCapture();
    capture.write({
      direction: "incoming",
      stage: "decoded",
      payload: [
        {
          tag: "session/update",
          payload: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "secret prompt" },
              authorization: "Bearer secret-token",
              workspace: "C:\\Users\\person\\project",
              environment: { SECRET: "secret-value" },
              blob: "a".repeat(10_000),
            },
          },
        },
      ],
    });

    const serialized = JSON.stringify(capture.records());
    expect(serialized).not.toContain("secret prompt");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("C:\\Users\\person\\project");
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("a".repeat(1_000));
    expect(capture.records()).toEqual([
      {
        method: "session/update",
        updateType: "agent_message_chunk",
        contentType: "text",
        classification: "ordinary text",
      },
    ]);
  });

  it("bounds each record and the in-memory capture", () => {
    const capture = makeDevinAcpCapture();
    for (let index = 0; index < 40; index += 1) {
      capture.write({
        direction: "incoming",
        stage: "decoded",
        payload: [
          {
            tag: "session/update",
            payload: {
              update: {
                sessionUpdate: `not-safe-${"x".repeat(1_000)}-${index}`,
                content: { type: "resource" },
              },
            },
          },
        ],
      });
    }

    expect(capture.records()).toHaveLength(32);
    for (const record of capture.records()) {
      expect(new TextEncoder().encode(JSON.stringify(record)).byteLength).toBeLessThanOrEqual(512);
      expect(record.classification).toBe("unsupported");
      expect(record.reason).toBe("redacted-size");
    }
  });

  it("classifies only observed ACP content shapes", () => {
    const cases = [
      ["text", "ordinary text"],
      ["resource_link", "resource link"],
      ["resource", "embedded resource"],
    ] as const;
    for (const [contentType, classification] of cases) {
      expect(
        captureDevinAcpUpdate({
          direction: "incoming",
          stage: "decoded",
          payload: {
            tag: "session/update",
            payload: {
              update: { sessionUpdate: "agent_message_chunk", content: { type: contentType } },
            },
          },
        })?.classification,
      ).toBe(classification);
    }
    expect(
      captureDevinAcpUpdate({
        direction: "incoming",
        stage: "decoded",
        payload: { tag: "session/elicitation", payload: {} },
      })?.classification,
    ).toBe("elicitation");
  });
});
