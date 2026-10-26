// OPS-1 test data: records shaped the way the government's Recall Retrieval API documents them
// (RecallID, RecallNumber, RecallDate, Description, URL, Title, Products[], Manufacturers[], Hazards[], Remedies[]...).
// These are INVENTED recalls for tests only (no real maker or model is claimed to be recalled). A real sample from
// https://www.saferproducts.gov/RestWebServices/Recall could not be fetched from the build workspace; checking the
// live answer against this shape is a row on docs/OWNER-CHECKLIST.md.
export const CPSC_SAMPLE = [
  {
    RecallID: 90001,
    RecallNumber: "99-001",
    RecallDate: "2026-07-30T00:00:00",
    LastPublishDate: "2026-07-31T00:00:00",
    Description: "The refrigerator's compressor relay can overheat, posing a fire hazard.",
    URL: "https://www.cpsc.gov/Recalls/2026/Testmaker-Recalls-Retro-Refrigerators",
    Title: "Testmaker Recalls Retro Refrigerators Due to Fire Hazard",
    Products: [
      { Name: "Testmaker retro refrigerators", Description: "Models TM-RR10 and TM-RR12 in red, blue and cream", Model: "TM-RR10, TM-RR12", Type: "Refrigerators", CategoryID: "1" },
    ],
    Manufacturers: [{ Name: "Testmaker Appliance Co., Ltd.", CompanyID: "" }],
    Hazards: [{ Name: "The relay can overheat, posing a fire hazard.", HazardType: "Fire", HazardTypeID: "1" }],
    Remedies: [{ Name: "Consumers should stop using the refrigerator and contact Testmaker for a free repair kit." }],
    RemedyOptions: [{ Option: "Repair" }],
  },
  {
    RecallID: 90002,
    RecallNumber: "99-002",
    RecallDate: "2026-06-10T00:00:00",
    Description: "Washing machine door latch can fail.",
    URL: "https://example.com/not-the-government",
    Title: "Washwell Recalls Front-Load Washing Machines",
    Products: [{ Name: "Washwell front-load washing machines", Description: "Model WW-4400", Model: "" }],
    Manufacturers: [{ Name: "Washwell Inc." }],
    Hazards: [{ Name: "Injury hazard" }],
    Remedies: [],
  },
  { RecallID: "", RecallNumber: "", Title: "A record with no identity is skipped" },
  "not an object",
];
