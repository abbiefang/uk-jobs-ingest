import { describe, expect, it } from "vitest";
import { fetchTeamtailor, normalizeTeamtailor } from "./teamtailor";

const company = { slug: "huaweiuk", ats: "teamtailor", company_name: "Huawei UK", careers_url: "https://huaweiuk.teamtailor.com", sponsor_matched: true, status: "active" as const, consecutive_failures: 0 };

const raw = {
  id: "449eca3c-62fc-4dec-981b-89a9c1b42404",
  title: "Research Scientist",
  url: "https://huaweiuk.teamtailor.com/jobs/8148449-research-scientist",
  date_published: "2026-07-30T10:30:38+01:00",
  content_html: "<p>Join the ML team. £55,000 - £70,000.</p>",
  _jobposting: {
    "@type": "JobPosting",
    title: "Research Scientist",
    datePosted: "2026-07-30T10:30:38+01:00",
    jobLocation: [
      { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "London", addressCountry: "GB" } },
    ],
  },
};

describe("normalizeTeamtailor", () => {
  it("maps a UK JSON Feed item with salary extracted from content_html", () => {
    const j = normalizeTeamtailor(raw, company);
    expect(j).toMatchObject({
      ats: "teamtailor",
      external_id: "449eca3c-62fc-4dec-981b-89a9c1b42404",
      company_name: "Huawei UK",
      title: "Research Scientist",
      city: "London",
      country_code: "GB",
      apply_url: "https://huaweiuk.teamtailor.com/jobs/8148449-research-scientist",
      posted_at: "2026-07-30T10:30:38+01:00",
      salary_min: 55000,
      salary_max: 70000,
      salary_currency: "GBP",
    });
    expect(j!.description_text).toContain("Join the ML team");
  });

  it("drops non-UK addressCountry", () => {
    expect(
      normalizeTeamtailor(
        {
          ...raw,
          _jobposting: {
            ...raw._jobposting,
            jobLocation: [{ address: { addressLocality: "Berlin", addressCountry: "DE" } }],
          },
        },
        company,
      ),
    ).toBeNull();
  });

  it("prefers structured baseSalary over description regex when present", () => {
    const j = normalizeTeamtailor(
      {
        ...raw,
        _jobposting: {
          ...raw._jobposting,
          baseSalary: { currency: "GBP", value: { minValue: 60000, maxValue: 80000 } },
        },
      },
      company,
    );
    expect(j?.salary_min).toBe(60000);
    expect(j?.salary_max).toBe(80000);
    expect(j?.salary_currency).toBe("GBP");
  });

  it("falls back to addressLocality text check when addressCountry is absent", () => {
    const j = normalizeTeamtailor(
      {
        ...raw,
        _jobposting: {
          ...raw._jobposting,
          jobLocation: [{ address: { addressLocality: "London" } }],
        },
      },
      company,
    );
    expect(j).not.toBeNull();
  });
});

describe("fetchTeamtailor", () => {
  it("requires company.careers_url and returns a non-gone error when absent", async () => {
    const result = await fetchTeamtailor({ ...company, careers_url: null }, { existingIds: new Set() });
    expect(result).toEqual({ ok: false, error: "no careers_url" });
  });
});
