import { describe, expect, it } from "vitest";
import { originAllowed } from "./origin";

const post = (url: string, headers: Record<string, string>) => new Request(url, { method: "POST", headers });
const dev = { NODE_ENV: "development" };
const prod = { NODE_ENV: "production" };

describe("same-origin check", () => {
  it("allows the server's own origin and requests without Origin", () => {
    expect(originAllowed(post("http://localhost:3000/api/x", { origin: "http://localhost:3000" }), prod)).toBe(true);
    expect(originAllowed(post("http://localhost:3000/api/x", {}), prod)).toBe(true);
  });
  it("accepts 127.0.0.1 and ::1 for localhost in development only", () => {
    const req = post("http://localhost:3000/api/x", { origin: "http://127.0.0.1:3000" });
    expect(originAllowed(req, dev)).toBe(true);
    expect(originAllowed(post("http://localhost:3000/api/x", { origin: "http://[::1]:3000" }), dev)).toBe(true);
    expect(originAllowed(post("http://localhost:3000/api/x", { origin: "http://127.0.0.1:3001" }), dev)).toBe(false);
  });
  it("accepts the IP address the browser connected to, like a LAN address", () => {
    const req = post("http://0.0.0.0:3000/api/x", { origin: "http://192.168.1.20:3000", host: "192.168.1.20:3000" });
    expect(originAllowed(req, prod)).toBe(true);
  });
  it("doesn't trust a domain from the Host header (DNS rebinding) unless it's in APP_ORIGIN", () => {
    const req = () => post("http://0.0.0.0:3000/api/x", { origin: "http://evil.test:3000", host: "evil.test:3000" });
    expect(originAllowed(req(), prod)).toBe(false);
    expect(originAllowed(post("http://0.0.0.0:3000/api/x", { origin: "https://agents.example.com", host: "agents.example.com" }), { ...prod, APP_ORIGIN: "https://agents.example.com" })).toBe(true);
  });
  it("rejects other sites and malformed origins", () => {
    expect(originAllowed(post("http://localhost:3000/api/x", { origin: "https://other.test" }), dev)).toBe(false);
    expect(originAllowed(post("http://localhost:3000/api/x", { origin: "null" }), dev)).toBe(false);
    expect(originAllowed(post("http://localhost:3000/api/x", { origin: "http://127.0.0.1:3000" }), prod)).toBe(false);
  });
});
