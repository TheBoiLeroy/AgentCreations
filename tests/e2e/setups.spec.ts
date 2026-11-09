import { expect, test, type Page } from "@playwright/test";
import { exampleAgent } from "../../packages/spec/src/index";

const profile = { handle: "eliancoder", display_name: "Ian", avatar_url: null };
const items = [
  { kind: "skill", repository: "anthropics/skills", skill: "pdf", note: "For contracts" },
  { kind: "skill", repository: "mattpocock/skills", skill: "grill-me", note: "" },
  { kind: "agent", spec: exampleAgent, note: "" },
];
const summary = {
  id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  slug: "daily-driver",
  title: "Daily driver",
  description: "How I plan and review.",
  item_count: 3,
  published: true,
  revision: 1,
  updated_at: "2026-11-09T00:00:00Z",
  profiles: profile,
};
// The dev server has no cloud storage; like the other cloud tests, the transport is mocked.
async function mockPublic(page: Page) {
  await page.route("**/api/setups**", (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.fallback();
    if (url.searchParams.get("slug")) return route.fulfill({ json: { profile, setup: { ...summary, items } } });
    if (url.searchParams.get("handle")) return route.fulfill({ json: { profile, setups: [summary] } });
    return route.fulfill({ json: { setups: [summary] } });
  });
}
test("find someone's setup, copy every skill and keep their agent", async ({ page }) => {
  await mockPublic(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Explore setups" }).click();
  await expect(page.getByRole("heading", { name: "Explore setups" })).toBeVisible();
  await page.getByRole("link", { name: "by @eliancoder" }).click();
  await expect(page.getByRole("heading", { name: "Ian", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View setup" }).click();
  await expect(page.getByRole("heading", { name: "Daily driver" })).toBeVisible();
  await expect(page.locator(".install-card pre")).toHaveText(
    "npx skills add anthropics/skills --skill pdf\nnpx skills add mattpocock/skills --skill grill-me",
  );
  await expect(page.getByText("For contracts")).toBeVisible();
  await expect(page.getByText("has not reviewed that code")).toBeVisible();
  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("status")).toContainText(/Copied the install script|Clipboard unavailable/);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download skill" }).click();
  expect((await download).suggestedFilename()).toBe("lead-sorter-skill.zip");
  await page.getByRole("button", { name: "Add to my agents" }).click();
  await expect(page.getByRole("status")).toContainText("Added “Lead sorter” to My agents as /lead-sorter");
  await page.goto("/");
  await page.getByRole("button", { name: /My agents/ }).click();
  await expect(page.getByRole("heading", { name: "Lead sorter", exact: true })).toBeVisible();
});
test("unreadable or missing setups say so instead of rendering stored content", async ({ page }) => {
  await page.route("**/api/setups**", (route) =>
    route.fulfill({ json: { profile, setup: { ...summary, items: [{ kind: "skill", repository: "a/b", skill: "x; rm -rf ~", note: "" }] } } }),
  );
  await page.goto("/u/eliancoder/daily-driver");
  await expect(page.locator("p.error")).toContainText("can't read");
  await expect(page.locator(".install-card")).toHaveCount(0);
  await page.unroute("**/api/setups**");
  await page.goto("/u/nobody-here/missing");
  await expect(page.locator("p.error")).toContainText("No profile with that name");
});
test("signed-out visitors are told what publishing needs", async ({ page }) => {
  await page.goto("/me?auth=unavailable");
  await expect(page.getByRole("heading", { name: "Share how you work." })).toBeVisible();
  await expect(page.getByText("GitHub sign-in isn’t set up on this site yet: add")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("GitHub sign-in isn’t set up on this site yet");
  await page.route("**/api/me", (route) => route.fulfill({ json: { configured: true, signIn: { github: true, dev: false }, profile: null, setups: [] } }));
  await page.goto("/me");
  await expect(page.getByRole("link", { name: "Sign in with GitHub" })).toHaveAttribute("href", "/auth/sign-in");
});
test("package skills and a built agent into a setup and publish it", async ({ page }) => {
  let saved: unknown;
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { configured: true, profile, setups: saved ? [{ ...summary, items }] : [] } }),
  );
  await page.route("**/api/setups", async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { ...summary, items } });
  });
  await page.addInitScript((spec) => {
    localStorage.setItem("agent-creations:library:v2", JSON.stringify([{ id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", spec }]));
  }, exampleAgent);
  await page.goto("/me");
  await expect(page.getByRole("link", { name: "agentcreations/u/eliancoder" })).toBeVisible();
  await page.getByRole("button", { name: "New setup" }).click();
  await page.getByRole("button", { name: "Save and publish" }).click();
  await expect(page.locator("p.error")).toContainText("Give your setup a title");
  await page.getByLabel("Title").fill("Daily driver");
  await page.getByLabel("Skill link or install command").fill("not a skill");
  await page.getByRole("button", { name: "Add skill" }).click();
  await expect(page.locator("p.error")).toContainText("Paste a skills.sh link");
  await page.getByLabel("Skill link or install command").fill("npx skills add mattpocock/skills --skill grill-me");
  await page.getByRole("button", { name: "Add skill" }).click();
  await page.getByRole("group", { name: "Popular skills" }).getByRole("button", { name: "Work with PDFs" }).click();
  await expect(page.getByRole("group", { name: "Popular skills" }).getByRole("button", { name: "Work with PDFs" })).toBeDisabled();
  await page.getByRole("group", { name: "Your agents" }).getByRole("button", { name: "Lead sorter" }).click();
  await page.getByLabel("Note for mattpocock/skills · grill-me").fill("Before every plan");
  await page.getByRole("button", { name: "Remove anthropics/skills · pdf" }).click();
  await page.getByRole("button", { name: "Save and publish" }).click();
  await expect(page.getByRole("status")).toContainText("Setup saved.");
  expect(saved).toMatchObject({
    title: "Daily driver",
    slug: "daily-driver",
    published: true,
    items: [
      { kind: "skill", repository: "mattpocock/skills", skill: "grill-me", note: "Before every plan" },
      { kind: "agent", spec: { trigger: "lead-sorter" } },
    ],
  });
  await expect(page.getByRole("heading", { name: "Daily driver" })).toBeVisible();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
});

// No mocks: the dev server's own local Turso database, cookies and sign-in.
test("dev sign-in, publish a setup to the local database and read it back as a visitor", async ({ page, browser }, info) => {
  const handle = `tester-${info.project.name}-${Date.now().toString(36)}`;
  await page.goto("/me");
  await page.getByLabel("Local dev sign-in (only on your machine under next dev)").fill(handle);
  await page.getByRole("button", { name: "Sign in locally" }).click();
  await expect(page.getByRole("link", { name: `agentcreations/u/${handle}` })).toBeVisible();
  await page.getByRole("button", { name: "New setup" }).click();
  await page.getByLabel("Title").fill("Stored for real");
  await page.getByLabel("Skill link or install command").fill("https://skills.sh/anthropics/skills/pdf");
  await page.getByRole("button", { name: "Add skill" }).click();
  await page.getByRole("button", { name: "Save and publish" }).click();
  await expect(page.getByRole("status")).toContainText("Setup saved.");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Stored for real" })).toBeVisible();
  // A different browser, signed out, sees the published setup.
  const visitor = await browser.newPage();
  await visitor.goto(`/u/${handle}/stored-for-real`);
  await expect(visitor.getByRole("heading", { name: "Stored for real" })).toBeVisible();
  await expect(visitor.locator(".setup-item code").first()).toHaveText("npx skills add anthropics/skills --skill pdf");
  await visitor.goto("/me");
  await expect(visitor.getByRole("heading", { name: "Share how you work." })).toBeVisible();
  await visitor.close();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "Share how you work." })).toBeVisible();
});
