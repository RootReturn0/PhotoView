import { describe, expect, it } from "vitest";
import {
  clamp,
  megabytesToBytesOrNull,
  numberOrNull,
  parseDraggedImageIds,
  settingValue,
} from "./app-utils";

describe("app utils", () => {
  it("normalizes numeric form input", () => {
    expect(numberOrNull(" 42 ")).toBe(42);
    expect(numberOrNull("")).toBeNull();
    expect(numberOrNull("abc")).toBeNull();
    expect(megabytesToBytesOrNull("1.5")).toBe(1_572_864);
  });

  it("keeps setting defaults compatible with JSON encoded values", () => {
    expect(settingValue(undefined, "system")).toBe("system");
    expect(settingValue('"dark"', "system")).toBe("dark");
    expect(settingValue("light", "system")).toBe("light");
    expect(settingValue("512", "192")).toBe("512");
  });

  it("clamps dimensions and ignores malformed drag payloads", () => {
    const fallback = ["original"];

    expect(clamp(16, 64, 512)).toBe(64);
    expect(clamp(900, 64, 512)).toBe(512);
    expect(clamp(192, 64, 512)).toBe(192);
    expect(parseDraggedImageIds('["a","b"]', fallback)).toEqual(["a", "b"]);
    expect(parseDraggedImageIds("[1]", fallback)).toBe(fallback);
    expect(parseDraggedImageIds("{", fallback)).toBe(fallback);
  });
});
