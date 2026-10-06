import { dbQuery, expect, test, USERS } from "./support/fixtures";

interface SessionRow {
  id: string;
  email: string;
}

/** A seeded Socra session that belongs to some student other than `exceptEmail`. */
async function seededSession(exceptEmail?: string): Promise<SessionRow> {
  const rows = await dbQuery<SessionRow>(
    `select s.id, u.email
       from "AiSession" s
       join "User" u on u.id = s."userId"
       join "AiMessage" m on m."sessionId" = s.id
      where u.email like 'student%@socra.local' and ($1::text is null or u.email <> $1)
      group by s.id, u.email
      order by count(m.id) desc, s.id
      limit 1`,
    [exceptEmail ?? null],
  );
  if (!rows[0]) throw new Error("No seeded Socra session found. Run npm run db:seed.");
  return rows[0];
}

test.describe("privacy boundaries", () => {
  test("faculty cannot read a raw student transcript", async ({ signedIn }) => {
    const session = await seededSession();
    const page = await signedIn(USERS.faculty);
    const res = await page.request.get(
      `/api/socra/transcripts/${session.id}?reason=${encodeURIComponent("checking whether faculty can read this")}`,
    );
    expect(res.status()).toBe(403);
    const body = await res.text();
    expect(body).not.toMatch(/"content"/);
  });

  test("faculty without a reason or with a bogus id is still refused", async ({ signedIn }) => {
    const page = await signedIn(USERS.faculty);
    const res = await page.request.get("/api/socra/transcripts/does-not-exist");
    expect([403, 404]).toContain(res.status());
  });

  test("faculty overview and question drilldown HTML never contain seeded student messages", async ({
    signedIn,
  }) => {
    test.setTimeout(120_000);
    // Plain-ASCII student messages, so HTML escaping cannot hide a leak.
    const msgs = await dbQuery<{ content: string }>(
      `select distinct content from "AiMessage"
        where role = 'USER' and length(content) between 25 and 120 and content ~ '^[A-Za-z0-9 ,.?]+$'
        limit 40`,
    );
    expect(msgs.length, "seed should contain plain student messages").toBeGreaterThan(0);

    const page = await signedIn(USERS.faculty);
    const pages = ["/faculty", "/faculty/analytics", "/faculty/insights"];
    await page.goto("/faculty/analytics");
    const href = await page
      .getByTestId("question-drilldown-link")
      .first()
      .getAttribute("href", { timeout: 30_000 });
    expect(href).toMatch(/^\/faculty\/insights\/questions\//);
    pages.push(href!);

    for (const path of pages) {
      const res = await page.request.get(path);
      expect(res.status(), path).toBe(200);
      const html = await res.text();
      for (const m of msgs) {
        expect(html.includes(m.content), `${path} leaked student message: "${m.content}"`).toBe(
          false,
        );
      }
    }
  });

  test("a student cannot read another student's Socra session", async ({ signedIn }) => {
    const session = await seededSession(USERS.student);
    const page = await signedIn(USERS.student);
    const res = await page.request.get(`/api/socra/sessions/${session.id}`);
    expect([403, 404]).toContain(res.status());
    expect(await res.text()).not.toMatch(/"content"/);

    const raw = await page.request.get(
      `/api/socra/transcripts/${session.id}?reason=curious+student`,
    );
    expect(raw.status()).toBe(403);
  });

  test("research admin without a grant cannot read raw transcripts", async ({ signedIn }) => {
    const [grants] = await dbQuery<{ n: string }>(
      `select count(*)::text as n from "PrivilegedAccessGrant" g join "User" u on u.id = g."userId"
        where u.email = $1 and g."revokedAt" is null and g."expiresAt" > now()`,
      [USERS.research],
    );
    test.skip(Number(grants?.n ?? 0) > 0, "research user already holds an active grant");

    const session = await seededSession();
    const page = await signedIn(USERS.research);
    const res = await page.request.get(
      `/api/socra/transcripts/${session.id}?reason=${encodeURIComponent("study protocol review, no grant held")}`,
    );
    expect(res.status()).toBe(403);
    expect(await res.text()).not.toMatch(/"content"/);
  });
});
