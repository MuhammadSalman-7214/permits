const permitTabs = [
  "PeopleData",
  "PermitFeeData",
  "PermitsForParcelData",
  "ReviewsAndActivity",
  "PermitInspections",
  "PermitConditionsData",
];
const cityEndpointMap = {
  bellevue: 1,
  bothell: 2,
  kirkland: 5,
  burien: 11,
};
function normalizeParcel(parcel) {
  if (!parcel) return null;
  let p = String(parcel).replace(/\s+/g, "");
  p = p.replace(/^-/, "");
  p = p.replace(/^(\d{6})(\d{4})$/, "$1-$2");
  return p;
}

function buildPermitApi(tab, caseNumber, parcel, city) {
  const endpoint = cityEndpointMap[city.toLowerCase()] || 5; // default 5
  if (tab === "PermitsForParcelData") {
    const normalized =
      city.toLowerCase() === "kirkland" ? normalizeParcel(parcel) : parcel;
    if (!normalized) return null;
    return `https://permitsearch.mybuildingpermit.com/PermitDetails/${tab}/${endpoint}/${normalized}`;
  }
  return `https://permitsearch.mybuildingpermit.com/PermitDetails/${tab}/${caseNumber}/${endpoint}`;
}

async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url, { timeout: 20000 });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

export async function scrapePermit(caseRecord, city) {
  const scrapedDetails = {};
  let permitNumber = caseRecord.CaseNumber || caseRecord.PERMITNUMBER;

  if (city.toLowerCase() === "bellevue") {
    permitNumber = encodeURIComponent(permitNumber.trim());
  }
  const parcel = caseRecord.SiteParcelNumber || caseRecord.PARCELNUMBER;
  await Promise.all(
    permitTabs.map(async (tab) => {
      const api = buildPermitApi(tab, permitNumber, parcel, city);
      console.log({ api });

      if (!api) return;
      const data = await fetchJsonSafe(api);
      if (!data) return;

      if (tab === "PeopleData") scrapedDetails.people = data;
      if (tab === "PermitFeeData") scrapedDetails.fees = data;
      if (tab === "ReviewsAndActivity") {
        scrapedDetails.reviews = Array.isArray(data)
          ? data.map((r) => ({
              ...r,
              ActivityStatus: stripHtml(r.ActivityStatus),
            }))
          : [];
      }
      if (tab === "PermitInspections") {
        {
          scrapedDetails.inspections = Array.isArray(data)
            ? data.map((r) => ({
                ...r,
                Status: stripHtml(r.Status),
              }))
            : [];
        }
      }
      if (tab === "PermitConditionsData") scrapedDetails.conditions = data;
      if (tab === "PermitsForParcelData") scrapedDetails.relatedPermits = data;
    })
  );
  return {
    permitNumber,
    detailPageUrl: caseRecord.moreinfo,
    scrapedDetails,
  };
}
