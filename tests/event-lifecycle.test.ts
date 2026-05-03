import { describe, it, expect } from "vitest";
import { advance, canAdvance, nextPhase } from "@/lib/event-lifecycle";

describe("EventLifecycle.nextPhase", () => {
  it("advances planning -> prep", () => {
    expect(nextPhase("planning")).toBe("prep");
  });
  it("advances prep -> on_event", () => {
    expect(nextPhase("prep")).toBe("on_event");
  });
  it("advances on_event -> post_event", () => {
    expect(nextPhase("on_event")).toBe("post_event");
  });
  it("returns null at terminal phase post_event", () => {
    expect(nextPhase("post_event")).toBeNull();
  });
});

describe("EventLifecycle.canAdvance", () => {
  it("allows chief at any non-terminal phase", () => {
    expect(canAdvance("planning", "chief")).toBe(true);
    expect(canAdvance("prep", "chief")).toBe(true);
    expect(canAdvance("on_event", "chief")).toBe(true);
  });
  it("forbids chief at terminal phase", () => {
    expect(canAdvance("post_event", "chief")).toBe(false);
  });
  it("forbids non-chief roles", () => {
    expect(canAdvance("planning", "lead_mechanic")).toBe(false);
    expect(canAdvance("prep", "assistant")).toBe(false);
    expect(canAdvance("on_event", "gopher")).toBe(false);
    expect(canAdvance("planning", "co_driver")).toBe(false);
    expect(canAdvance("planning", "driver")).toBe(false);
  });
});

describe("EventLifecycle.advance", () => {
  it("returns ok+next phase for chief on planning", () => {
    expect(advance("planning", "chief")).toEqual({ ok: true, phase: "prep" });
  });
  it("walks all four phases for chief", () => {
    expect(advance("prep", "chief")).toEqual({ ok: true, phase: "on_event" });
    expect(advance("on_event", "chief")).toEqual({ ok: true, phase: "post_event" });
  });
  it("refuses non-chief with structured failure", () => {
    const result = advance("planning", "lead_mechanic");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/chief/i);
  });
  it("refuses chief at post_event with structured failure", () => {
    const result = advance("post_event", "chief");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/terminal|post_event|already/i);
  });
});
