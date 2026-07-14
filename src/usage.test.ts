import { describe, it } from "node:test";
import assert from "node:assert";
import {
  nonNegativeNumber,
  parseResetAtMs,
  isFoundingSeat,
} from "../dist/usage.js";

void describe("nonNegativeNumber", () => {
  void it("returns the value for positive numbers", () => {
    assert.strictEqual(nonNegativeNumber(42), 42);
    assert.strictEqual(nonNegativeNumber(0), 0);
    assert.strictEqual(nonNegativeNumber(1e6), 1_000_000);
  });

  void it("returns undefined for negative numbers", () => {
    assert.strictEqual(nonNegativeNumber(-1), undefined);
  });

  void it("returns undefined for non-finite values", () => {
    assert.strictEqual(nonNegativeNumber(Number.NaN), undefined);
    assert.strictEqual(nonNegativeNumber(Infinity), undefined);
  });

  void it("parses numeric strings", () => {
    assert.strictEqual(nonNegativeNumber("42"), 42);
    assert.strictEqual(nonNegativeNumber("0"), 0);
  });

  void it("returns undefined for non-numeric strings", () => {
    assert.strictEqual(nonNegativeNumber(""), undefined);
    assert.strictEqual(nonNegativeNumber("abc"), undefined);
  });

  void it("returns undefined for non-number, non-string inputs", () => {
    assert.strictEqual(nonNegativeNumber(null), undefined);
    assert.strictEqual(nonNegativeNumber(undefined), undefined);
    assert.strictEqual(nonNegativeNumber({}), undefined);
    assert.strictEqual(nonNegativeNumber([]), undefined);
  });
});

void describe("parseResetAtMs", () => {
  void it("parses a valid ISO date string", () => {
    const result = parseResetAtMs("2026-07-14T23:00:00Z");
    assert.ok(result !== undefined);
    assert.strictEqual(typeof result, "number");
    assert.ok(result > 0);
  });

  void it("returns undefined for undefined input", () => {
    assert.strictEqual(parseResetAtMs(undefined), undefined);
  });

  void it("returns undefined for empty string", () => {
    assert.strictEqual(parseResetAtMs(""), undefined);
  });

  void it("returns undefined for invalid date", () => {
    assert.strictEqual(parseResetAtMs("not-a-date"), undefined);
  });
});

void describe("isFoundingSeat", () => {
  void it("detects 'founding' in the display name", () => {
    assert.strictEqual(
      isFoundingSeat("code_pro", "Code Pro (Founding Seat)"),
      true,
    );
  });

  void it("detects 'founding' in the slug", () => {
    assert.strictEqual(
      isFoundingSeat("code_pro_founding", "Code Pro"),
      true,
    );
  });

  void it("returns false for non-founding seats", () => {
    assert.strictEqual(isFoundingSeat("code_pro", "Code Pro"), false);
    assert.strictEqual(isFoundingSeat("code_max", "Code Max"), false);
    assert.strictEqual(isFoundingSeat("unknown", "Starter"), false);
  });

  void it("returns false when both inputs are empty/undefined", () => {
    assert.strictEqual(isFoundingSeat(undefined, undefined), false);
    assert.strictEqual(isFoundingSeat("", ""), false);
  });

  void it("is case-insensitive", () => {
    assert.strictEqual(
      isFoundingSeat("CODE_PRO_FOUNDING", "Code Pro"),
      true,
    );
    assert.strictEqual(
      isFoundingSeat("code_pro", "CODE PRO (FOUNDING SEAT)"),
      true,
    );
  });
});
