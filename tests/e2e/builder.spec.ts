import { expect, test, type Page } from "@playwright/test";
import { exampleAgent } from "../../packages/spec/src/index";
async function start(page: Page, name = "Quote Writer") {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: /Creation & Communication.*Choose this direction/,
    })
    .click();
  await expect(page.getByRole("status")).toContainText("Added to agent build");
  await page
    .getByRole("button", { name: "Name your agent", exact: true })
    .click();
  await page.getByLabel("Name your agent", { exact: true }).fill(name);
  await expect(page.getByTestId("trigger")).toContainText("/quote-writer");
  await page.getByRole("button", { name: "Tell us what it needs" }).click();
}
async function needs(page: Page) {
  await page.getByRole("button", { name: "Emails", exact: true }).click();
  await page
    .getByRole("button", { name: "An email sent", exact: true })
    .click();
  await page
    .getByLabel("Anything else Jev should know?")
    .fill("Write a friendly quote from the customer emails.");
  await page.getByRole("button", { name: "Find my agent’s skills" }).click();
  await expect(
    page.getByRole("heading", { name: "A few skills. Chosen for a reason." }),
  ).toBeVisible();
}
async function answerDetails(page: Page, input: string, sections: string) {
  await page.getByRole("button", { name: "Add the details" }).click();
  await expect(
    page.getByRole("heading", { name: "What does it need to run?" }),
  ).toBeVisible();
  await expect(page.getByLabel("Open questions")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review my agent" }),
  ).toBeDisabled();
  await page.getByLabel("Input 1", { exact: true }).fill(input);
  await page
    .getByLabel("Sections the result must have (one per line)")
    .fill(sections);
  await page
    .getByLabel("When should your main agent suggest it?")
    .fill(`Use when the user wants help with ${input.toLowerCase()}.`);
  await expect(page.getByLabel("Open questions")).toHaveCount(0);
  await page.getByRole("button", { name: "Review my agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Meet your newest helper." }),
  ).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/agent-builds", async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({ json: { configured: false, builds: [] } });
    else await route.continue();
  });
});
test("research mailer asks two questions, shows permissions and preserves answers through Back", async ({ page }) => {
  await start(page);
  await page.getByLabel("Anything else Jev should know?").fill("research a topic and email me");
  await page.getByRole("button", { name: "Find my agent’s skills" }).click();
  await expect(page.getByRole("switch", { name: "Send email", exact: true })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Search the web", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Add the details" }).click();
  await expect(page.getByRole("radio", { name: "Answers once when I run it" })).not.toBeVisible();
  await expect(page.getByLabel("Selected skill permissions")).toContainText("sends email");
  await page.getByLabel("What topics should it research?").fill("Battery recycling");
  await page.getByLabel("Which email should it send to?").fill("owner@example.com");
  await page.getByRole("button", { name: "Review my agent" }).click();
  await expect(page.getByRole("heading", { name: "Meet your newest helper." })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("What topics should it research?")).toHaveValue("Battery recycling");
  await expect(page.getByLabel("Which email should it send to?")).toHaveValue("owner@example.com");
});

test("search and browse every curated skill without changing selections", async ({ page }) => {
  await start(page);
  await needs(page);
  const send = page.getByRole("switch", { name: "Send email", exact: true });
  await expect(send).toBeChecked();
  await page.getByText("Add more from the catalog", { exact: false }).click();
  await expect(page.getByRole("switch", { name: "Test web apps", exact: true })).not.toBeVisible();
  while (await page.getByRole("button", { name: /Load more skills/ }).isVisible()) {
    await page.getByRole("button", { name: /Load more skills/ }).click();
  }
  await expect(page.getByRole("switch")).toHaveCount(25);
  await page.getByRole("switch", { name: "Test web apps", exact: true }).check();

  await page.getByLabel("Search skills", { exact: true }).fill("  CONNECTED MAILBOX  ");
  await expect(send).toBeVisible();
  await expect(send).toBeChecked();
  await expect(page.getByRole("switch")).toHaveCount(1);
  await page.getByLabel("Search skills", { exact: true }).fill("no-such-skill");
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByText("No other skills match.", { exact: false })).toBeVisible();
  await page.getByLabel("Search skills", { exact: true }).fill("");
  await page.getByRole("group", { name: "Skill categories" }).getByRole("button", { name: "Dev", exact: true }).click();
  await expect(page.getByRole("switch")).toHaveCount(6);
  await expect(page.getByRole("switch", { name: "Test web apps", exact: true })).toBeChecked();
  await page.getByRole("group", { name: "Skill categories" }).getByRole("button", { name: "All", exact: true }).click();
  await expect(send).toBeChecked();

  await page.getByRole("button", { name: "Add the details" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByLabel("Search skills", { exact: true }).fill("webapp-testing");
  await expect(page.getByRole("switch", { name: "Test web apps", exact: true })).toBeChecked();
});

test("complete the new flow, customize tools, export and keep created agent after refresh", async ({
  page,
}) => {
  await start(page);
  await needs(page);
  await expect(
    page.getByRole("switch", { name: "Send email", exact: true }),
  ).toBeChecked();
  await expect(
    page
      .locator(".tool-card")
      .filter({
        has: page.getByRole("switch", { name: "Send email", exact: true }),
      })
      .getByText("Asks before sending or changing", { exact: true }),
  ).toBeVisible();
  await page.getByRole("switch", { name: "Send email", exact: true }).uncheck();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Anything else Jev should know?")).toHaveValue(
    "Write a friendly quote from the customer emails.",
  );
  await page.getByRole("button", { name: "Find my agent’s skills" }).click();
  await expect(
    page.getByRole("switch", { name: "Send email", exact: true }),
  ).not.toBeChecked();
  await page.getByText("Add more from the catalog", { exact: false }).click();
  await page
    .getByRole("switch", { name: "Review & check", exact: true })
    .check();
  await answerDetails(page, "Customer emails", "Quote\nNext steps");
  await expect(page.locator(".follow-up")).toContainText(
    "`read-email` isn't a tool this exporter can supply.",
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Input 1", { exact: true })).toHaveValue(
    "Customer emails",
  );
  await page.getByRole("button", { name: "Review my agent" }).click();
  await page.getByRole("button", { name: "Create my agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Where do you want to use it?" }),
  ).toBeVisible();
  // Read email can't be supplied to a Pi worker: the Pi export stops and says why.
  await expect(page.locator(".problem-list")).toContainText(
    "`read-email` isn't a tool this exporter can supply.",
  );
  await expect(
    page.getByRole("button", { name: "Download Pi package" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Claude Code", exact: true }).click();
  await expect(page.locator(".install-card")).toContainText("~/.claude/skills");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download skill" }).click();
  expect((await downloaded).suggestedFilename()).toBe("quote-writer-skill.zip");
  await page.reload();
  await expect(page.locator(".category-art svg")).toHaveCount(5);
  await page.getByRole("button", { name: /My agents/ }).click();
  await expect(
    page.getByRole("heading", { name: "Quote Writer", exact: true }),
  ).toBeVisible();
});
test("Jev suggests external skills with source links and preserves selection through Back", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "A slide deck", exact: true }).click();
  await page.getByLabel("Anything else Jev should know?").fill("Create a PowerPoint presentation");
  await page.getByRole("button", { name: "Find my agent’s skills" }).click();
  const skill = page.getByRole("switch", { name: "Create presentations", exact: true });
  await expect(skill).toBeChecked();
  await expect(page.getByRole("link", { name: "View on skills.sh · anthropics/skills", exact: true }).first()).toHaveAttribute("href", "https://skills.sh/anthropics/skills/pptx");
  await skill.uncheck();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("button", { name: "A slide deck", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Find my agent’s skills" }).click();
  await expect(skill).not.toBeChecked();
  await skill.check();
  await answerDetails(page, "Talking points", "Slides");
  await page.getByText("Preview the saved agent spec").click();
  await expect(page.locator(".spec-details pre")).toContainText('"schemaVersion": 3');
  await expect(page.locator(".spec-details pre")).toContainText('"repository": "anthropics/skills"');
  await page.reload();
  await expect(page.locator(".category-art svg")).toHaveCount(5);
});
test("Back keeps answers but refresh starts a fresh build at step one", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("button", { name: "A spreadsheet", exact: true })
    .click();
  await page
    .getByLabel("Anything else Jev should know?")
    .fill("Sort the leads by urgency");
  await expect(
    page.getByRole("heading", { name: "What will your agent need?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "A spreadsheet", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Anything else Jev should know?")).toHaveValue(
    "Sort the leads by urgency",
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Name your agent", { exact: true })).toHaveValue(
    "Quote Writer",
  );
  await expect(page.getByTestId("trigger")).toHaveText("/quote-writer");
  await expect(page.locator("input")).toHaveCount(2); // hidden import + name only
  await page.reload();
  await expect(page.locator(".category-art svg")).toHaveCount(5);
  await page.getByRole("button", {
    name: /Creation & Communication.*Choose this direction/,
  }).click();
  await page.getByRole("button", { name: "Name your agent", exact: true }).click();
  await expect(page.getByLabel("Name your agent", { exact: true })).toHaveValue("");
});
test("duplicate names get a suffix and v1 imports still export", async ({
  page,
}) => {
  const {
    trigger, tools, runtime, inputs, method, dataSources, conversation, skill,
    ...old
  } = exampleAgent;
  const { inputChips, outputChips, context, ...oldNeeds } = old.needs;
  const { kind, template, ...oldOutput } = old.output;
  await page.goto("/");
  await page
    .getByLabel("Import agent JSON")
    .setInputFiles({
      name: "agent.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          ...old,
          schemaVersion: 1,
          name: "Quote Writer",
          slug: "quote-writer",
          needs: oldNeeds,
          output: oldOutput,
        }),
      ),
    });
  await expect(
    page.getByRole("heading", { name: "Where do you want to use it?" }),
  ).toBeVisible();
  // Migrated v1 specs have no method or output sections yet: the export says so.
  await expect(page.locator(".problem-list")).toContainText(
    "Add the steps this agent should follow.",
  );
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await page
    .getByRole("button", {
      name: /Creation & Communication.*Choose this direction/,
    })
    .click();
  await page
    .getByRole("button", { name: "Name your agent", exact: true })
    .click();
  await page
    .getByLabel("Name your agent", { exact: true })
    .fill("Quote Writer");
  await expect(page.getByTestId("trigger")).toHaveText("/quote-writer-2");
});
test("dark mode, reduced motion and mobile layout work with original inline SVGs", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".category-art svg")).toHaveCount(5);
  expect(
    await page
      .locator(".category-art svg g")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  expect(
    await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(7, 11, 20)");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", {
      name: /Creation & Communication.*Choose this direction/,
    })
    .click();
  await expect(page.locator(".build-identity svg")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Name your agent", exact: true })
    .click();
  await expect(
    page.getByLabel("Name your agent", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("name-dark-reduced-motion.png"),
    fullPage: true,
  });
});
test("dark blue is the default and the theme toggle persists", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(7, 11, 20)");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(243, 246, 252)");
  await page.reload();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(243, 246, 252)");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.reload();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(7, 11, 20)");
});
test("Jev network failure falls back to rules and Back cancels the reading screen", async ({
  page,
}) => {
  await page.route("**/api/jev", (route) => route.abort());
  await start(page);
  await needs(page);
  await expect(page.getByRole("status")).toContainText(
    "rule-based recommendations",
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page
    .getByLabel("Anything else Jev should know?")
    .fill("A changed task about email");
  await page.getByRole("button", { name: "Find my agent’s skills" }).click();
  await expect(
    page.getByRole("heading", { name: "Jev is reading…" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "What will your agent need?" }),
  ).toBeVisible();
  await page.waitForTimeout(1300);
  await expect(
    page.getByRole("heading", { name: "What will your agent need?" }),
  ).toBeVisible();
});
test("cloud drafts are patched but do not automatically resume after refresh", async ({
  page,
}) => {
  let row: Record<string, unknown> | null = null;
  let patches = 0;
  await page.route("**/api/agent-builds", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { configured: true, builds: row ? [row] : [] },
      });
    const body = route.request().postDataJSON();
    row = {
      id: body.id,
      revision: 1,
      draft: body.draft,
      trigger: body.draft.name ? "quote-writer" : null,
      spec: null,
    };
    await route.fulfill({ status: 201, json: row });
  });
  await page.route("**/api/agent-builds/*", async (route) => {
    const body = route.request().postDataJSON();
    patches++;
    row = {
      ...row,
      revision: Number(row?.revision || 0) + 1,
      draft: body.draft,
      trigger: body.draft.name ? "quote-writer" : null,
      spec: null,
    };
    await route.fulfill({ json: row });
  });
  await start(page);
  await page
    .getByLabel("Anything else Jev should know?")
    .fill("Write quotes from customer notes");
  await expect(page.locator(".save-status")).toContainText("Saved to cloud");
  await expect.poll(() => patches).toBeGreaterThan(0);
  await expect
    .poll(() => (row?.draft as { context?: string })?.context)
    .toBe("Write quotes from customer notes");
  await page.evaluate(() =>
    localStorage.removeItem("agent-creations:build:v2"),
  );
  await page.reload();
  await expect(page.locator(".category-art svg")).toHaveCount(5);
  await expect(page.locator(".save-status")).toContainText("Saved to cloud");
  await expect(page.locator(".category-art svg")).toHaveCount(5);
});
test("live agents become Pi extensions with data sources and a toggle command", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /Support & Oversight.*Choose this direction/ })
    .click();
  await page.getByRole("button", { name: "Name your agent", exact: true }).click();
  await page.getByLabel("Name your agent", { exact: true }).fill("Agent Tracker");
  await page.getByRole("button", { name: "Tell us what it needs" }).click();
  await page
    .getByRole("button", { name: "A live panel in the terminal", exact: true })
    .click();
  await page
    .getByLabel("Anything else Jev should know?")
    .fill("Track the agents running on my machine and give a UI in the CLI.");
  await page.getByRole("button", { name: "Find my agent’s skills" }).click();
  await page.getByRole("button", { name: "Add the details" }).click();
  await page.getByText("Advanced", { exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "Keeps running in the terminal" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByText("Advanced live settings", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pi session activity" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Pi session activity" }).click();
  await page.getByRole("button", { name: "Running agent processes" }).click();
  await expect(page.getByLabel("Open questions")).toContainText(
    "Where should this agent get its live data?",
  );
  await page.getByRole("button", { name: "Running agent processes" }).click();
  await page.getByRole("button", { name: "Review my agent" }).click();
  await expect(page.locator(".review-card code")).toHaveText("/agent-tracker");
  await page.getByRole("button", { name: "Create my agent" }).click();
  await expect(page.locator(".test-prompt")).toContainText("/agent-tracker");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Pi package" }).click();
  expect((await downloaded).suggestedFilename()).toBe("agent-tracker-pi.zip");
  await page.getByRole("button", { name: "Claude Code", exact: true }).click();
  await expect(page.locator(".problem-list")).toContainText(
    "This agent runs as a Pi extension. Choose Pi to export it.",
  );
});
