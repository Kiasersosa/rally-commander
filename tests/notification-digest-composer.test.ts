import { describe, it, expect } from "vitest";
import {
  composeDigest,
  type DigestInput,
} from "@/lib/notification-digest-composer";

const baseInput = (): DigestInput => ({
  user: { id: "u1", name: "Jason", role: "chief" },
  period: { fromIso: "2026-05-01T00:00:00Z", toIso: "2026-05-08T00:00:00Z" },
  upcomingTodos: [],
  upcomingEvents: [],
  expirations: [],
  newOrUpdatedDocuments: [],
});

describe("NotificationDigestComposer.composeDigest", () => {
  it("empty week: no body sections, hasContent=false", () => {
    const d = composeDigest(baseInput());
    expect(d.hasContent).toBe(false);
    expect(d.subject).toMatch(/Rally Commander/i);
    // Empty digest still gets a friendly body
    expect(d.body).toMatch(/nothing on the calendar/i);
  });

  it("greets the user by name in the body", () => {
    const d = composeDigest(baseInput());
    expect(d.body).toMatch(/Hi Jason/);
  });

  it("includes a 'Your todos' section when there are upcoming todos", () => {
    const input = baseInput();
    input.upcomingTodos = [
      { id: "t1", title: "Order brake pads", eventName: "Olympus 2026" },
      { id: "t2", title: "Pack ECU laptop", eventName: "Olympus 2026" },
    ];
    const d = composeDigest(input);
    expect(d.hasContent).toBe(true);
    expect(d.body).toMatch(/Your todos/);
    expect(d.body).toContain("Order brake pads");
    expect(d.body).toContain("Pack ECU laptop");
  });

  it("includes an 'Upcoming events' section when events are within the window", () => {
    const input = baseInput();
    input.upcomingEvents = [
      { id: "e1", name: "Olympus 2026", eventDate: "2026-06-14", location: "Shelton, WA" },
    ];
    const d = composeDigest(input);
    expect(d.body).toMatch(/Upcoming events/);
    expect(d.body).toContain("Olympus 2026");
    expect(d.body).toContain("2026-06-14");
  });

  it("includes 'Expirations' grouped by band when warnings exist", () => {
    const input = baseInput();
    input.expirations = [
      { id: "s1", label: "Helmet · H-001", band: "1mo", daysUntilExpiry: 22 },
      { id: "s2", label: "ARA license · driver", band: "3mo", daysUntilExpiry: 75 },
      { id: "s3", label: "Medical · driver", band: "6mo", daysUntilExpiry: 150 },
    ];
    const d = composeDigest(input);
    expect(d.body).toMatch(/Expirations coming up/);
    expect(d.body).toContain("Helmet · H-001");
    expect(d.body).toContain("ARA license");
  });

  it("excludes 'ok' and 'no_expiry' bands from the digest expirations list", () => {
    const input = baseInput();
    input.expirations = [
      { id: "ok", label: "Way out", band: "ok", daysUntilExpiry: 365 },
      { id: "none", label: "No date", band: "no_expiry", daysUntilExpiry: null },
      { id: "soon", label: "Helmet", band: "1mo", daysUntilExpiry: 20 },
    ];
    const d = composeDigest(input);
    expect(d.body).toContain("Helmet");
    expect(d.body).not.toContain("Way out");
    expect(d.body).not.toContain("No date");
  });

  it("includes 'New documents' section with version numbers", () => {
    const input = baseInput();
    input.newOrUpdatedDocuments = [
      {
        id: "d1",
        name: "Bulletin 2",
        eventName: "Olympus 2026",
        versionNumber: 3,
        mustAcknowledge: true,
      },
    ];
    const d = composeDigest(input);
    expect(d.body).toMatch(/New (?:and updated )?documents/);
    expect(d.body).toContain("Bulletin 2 · v3");
    expect(d.body).toMatch(/must acknowledge/i);
  });

  it("subject reflects content highlights (not generic) when there's a top urgent item", () => {
    const input = baseInput();
    input.expirations = [
      { id: "exp", label: "Medical · driver", band: "1w", daysUntilExpiry: 5 },
    ];
    const d = composeDigest(input);
    // When something needs urgent attention, subject names it
    expect(d.subject).toMatch(/expiring|attention|alert/i);
  });

  it("plain-text rendering does not include HTML tags", () => {
    const input = baseInput();
    input.upcomingTodos = [
      { id: "t1", title: "Some <strong>thing</strong>", eventName: null },
    ];
    const d = composeDigest(input);
    // We escape user content; raw <strong> should not survive into body.
    expect(d.body).not.toContain("<strong>");
  });

  it("counts: returns top-line summary fields", () => {
    const input = baseInput();
    input.upcomingTodos = [
      { id: "t1", title: "x", eventName: null },
      { id: "t2", title: "y", eventName: null },
    ];
    input.expirations = [
      { id: "s1", label: "x", band: "1mo", daysUntilExpiry: 20 },
    ];
    input.newOrUpdatedDocuments = [
      { id: "d1", name: "x", eventName: null, versionNumber: 1, mustAcknowledge: false },
    ];
    const d = composeDigest(input);
    expect(d.todoCount).toBe(2);
    expect(d.expirationCount).toBe(1);
    expect(d.documentCount).toBe(1);
    expect(d.hasContent).toBe(true);
  });
});
