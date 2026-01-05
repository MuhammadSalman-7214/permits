// lib/scrapePermit.js
import https from "https";
import fetch from "node-fetch"; // Ensure node-fetch is installed or use global fetch in Node 18+

const permitTabs = [
  "PeopleData",
  "PermitFeeData",
  "PermitsForParcelData",
  "ReviewsAndActivity",
  "PermitInspections",
  "PermitConditionsData",
];

const cityEndpointMap = { bellevue: 1, bothell: 2, kirkland: 5, burien: 11 };

// Reusing connections is the #1 way to speed up thousands of small calls
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100, // Adjust based on your RAM/Network
});

function buildPermitApi(tab, caseNumber, parcel, city) {
  const endpoint = cityEndpointMap[city.toLowerCase()] || 5;
  if (tab === "PermitsForParcelData") {
    if (!parcel) return null;
    return `https://permitsearch.mybuildingpermit.com/PermitDetails/${tab}/${endpoint}/${parcel}`;
  }
  return `https://permitsearch.mybuildingpermit.com/PermitDetails/${tab}/${caseNumber}/${endpoint}`;
}

async function fetchWithRetry(url, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const res = await fetch(url, {
        agent: keepAliveAgent,
        timeout: 10000,
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === maxRetries) return null;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
}

export async function scrapePermit(caseRecord, city) {
  let permitNumber =
    caseRecord.CaseNumber || caseRecord.PERMITNUMBER || caseRecord.PermitNumber;
  if (!permitNumber) return null;

  const parcel = caseRecord.SiteParcelNumber || caseRecord.PARCELNUMBER;
  const scrapedDetails = {};

  // Execute all 6 tabs for ONE permit in parallel
  // We use a map to maintain keys
  const tasks = permitTabs.map(async (tab) => {
    const api = buildPermitApi(tab, permitNumber, parcel, city);

    if (!api) return null;
    const data = await fetchWithRetry(api);
    return { tab, data };
  });

  const results = await Promise.all(tasks);

  results.forEach((res) => {
    if (!res || !res.data) return;
    const { tab, data } = res;
    if (tab === "PeopleData") scrapedDetails.people = data;
    if (tab === "PermitFeeData") scrapedDetails.fees = data;
    if (tab === "ReviewsAndActivity")
      scrapedDetails.reviews = Array.isArray(data)
        ? data.map((r) => ({
            ...r,
            ActivityStatus: String(r.ActivityStatus || "").replace(
              /<[^>]*>/g,
              ""
            ),
          }))
        : [];
    if (tab === "PermitInspections")
      scrapedDetails.inspections = Array.isArray(data)
        ? data.map((r) => ({
            ...r,
            Status: String(r.Status || "").replace(/<[^>]*>/g, ""),
          }))
        : [];
    if (tab === "PermitConditionsData") scrapedDetails.conditions = data;
    if (tab === "PermitsForParcelData") scrapedDetails.relatedPermits = data;
  });

  return {
    permitNumber,
    detailPageUrl: caseRecord.moreinfo || caseRecord.MBPSTATUSSITE || "",
    scrapedDetails,
  };
}
