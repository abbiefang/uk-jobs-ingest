// Hand-verified starter set, all live-probed 2026-07-30.
// discover.ts's --seed mode reads { name, ats, slug } and derives careers_url itself
// (teamtailorCareersUrl) and sponsor_matched against the live register.
export const SEED = [
  { slug: "monzo", ats: "greenhouse", name: "Monzo" },
  { slug: "zopa", ats: "lever", name: "Zopa Bank" },
  { slug: "theodo", ats: "lever", name: "Theodo" },
  { slug: "kraken123", ats: "lever", name: "Kraken" },
  { slug: "synthesia", ats: "ashby", name: "Synthesia" },
  { slug: "elevenlabs", ats: "ashby", name: "ElevenLabs" },
  { slug: "wayve", ats: "ashby", name: "Wayve" },
  { slug: "starling-bank", ats: "workable", name: "Starling Bank" },
  { slug: "withplum", ats: "workable", name: "Plum Fintech" },
  { slug: "our-future-health", ats: "workable", name: "Our Future Health" },
  { slug: "Wise", ats: "smartrecruiters", name: "Wise" },
  { slug: "ASOS", ats: "smartrecruiters", name: "ASOS" },
  { slug: "UtilityWarehouse1", ats: "smartrecruiters", name: "Utility Warehouse" },
  { slug: "framestore", ats: "recruitee", name: "Framestore" },
  { slug: "waracle", ats: "recruitee", name: "Waracle" },
  { slug: "huaweiuk", ats: "teamtailor", name: "Huawei R&D UK" },
] as const;
