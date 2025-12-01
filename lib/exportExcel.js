import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const EXCEL_SAFE_LIMIT = 32000;

function sanitizeCell(val) {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") {
    return val.length > EXCEL_SAFE_LIMIT
      ? val.slice(0, EXCEL_SAFE_LIMIT) + " ...[TRUNCATED]"
      : val;
  }
  if (typeof val === "object") {
    try {
      const s = JSON.stringify(val);
      return s.length > EXCEL_SAFE_LIMIT
        ? s.slice(0, EXCEL_SAFE_LIMIT) + " ...[TRUNCATED]"
        : s;
    } catch {
      return String(val).slice(0, EXCEL_SAFE_LIMIT);
    }
  }
  return String(val);
}

// Safely parse string as JSON, fallback to eval for array-like strings
function safeParse(str) {
  if (!str) return [];
  if (Array.isArray(str)) return str;
  try {
    return JSON.parse(str);
  } catch {
    // fallback: try to convert string array manually
    try {
      return eval(str); // eslint-disable-line no-eval
    } catch {
      return [str]; // fallback to single string
    }
  }
}

// Convert array-of-arrays table to proper Excel rows
function tableRowsForAll(results, tableKey, headers) {
  const rows = [];
  for (const r of results) {
    const table = safeParse(r.scrapedDetails?.[tableKey]);
    if (!table || table.length === 0) {
      rows.push({
        permitNumber: r.permitNumber,
        detailPageUrl: r.detailPageUrl,
      });
      continue;
    }
    for (const row of table) {
      const obj = {
        permitNumber: r.permitNumber,
        detailPageUrl: r.detailPageUrl,
      };
      headers.forEach((h, i) => (obj[h] = sanitizeCell(row[i] || "")));
      rows.push(obj);
    }
  }
  return rows;
}

export async function saveExcelBuffer(results) {
  const wb = XLSX.utils.book_new();
  // --- MAIN SHEET ---
  const mainRows = results.map((r) => ({
    permitNumber: r.permitNumber,
    detailPageUrl: r.detailPageUrl,
    ProjectName: r.scrapedDetails?.summaryLeft?.["Project Name"] || "",
    Jurisdiction: r.scrapedDetails?.summaryLeft?.["Jurisdiction"] || "",
    Type: r.scrapedDetails?.summaryLeft?.["Type"] || "",
    Address: r.scrapedDetails?.summaryLeft?.["Address"] || "",
    Parcel: r.scrapedDetails?.summaryLeft?.["Parcel"] || "",
    Status: r.scrapedDetails?.summaryRight?.["Status"] || "",
    AppliedDate: r.scrapedDetails?.summaryRight?.["Applied Date"] || "",
    IssuedDate: r.scrapedDetails?.summaryRight?.["Issued Date"] || "",
    PermitExpiration:
      r.scrapedDetails?.summaryRight?.["Permit Expiration"] || "",
    Description: r.scrapedDetails?.description || "",
  }));

  const wsMain = XLSX.utils.json_to_sheet(mainRows);
  XLSX.utils.book_append_sheet(wb, wsMain, "Permits");

  // --- PEOPLE ---
  const peopleHeaders = ["Role", "Name", "License"];
  const peopleRows = tableRowsForAll(results, "people", peopleHeaders);
  if (peopleRows.length) {
    const ws = XLSX.utils.json_to_sheet(peopleRows);
    XLSX.utils.book_append_sheet(wb, ws, "People");
  }

  // --- FEES ---
  const feesHeaders = ["Fee Type", "Fee Code", "Fee Amount", "Paid"];
  const feesRows = tableRowsForAll(results, "fees", feesHeaders);
  if (feesRows.length) {
    const ws = XLSX.utils.json_to_sheet(feesRows);
    XLSX.utils.book_append_sheet(wb, ws, "Fees");
  }

  // --- REVIEWS ---
  const reviewsHeaders = [
    "Reviewer",
    "Review Type",
    "Name",
    "Extra1",
    "Status",
    "Date",
    "Extra2",
  ];

  const reviewsRows = tableRowsForAll(results, "reviews", reviewsHeaders);
  if (reviewsRows.length) {
    const ws = XLSX.utils.json_to_sheet(reviewsRows);
    XLSX.utils.book_append_sheet(wb, ws, "Reviews");
  }

  // --- RELATED PERMITS ---
  const relatedPermitsHeaders = [
    "Related Type",
    "PermitNumber",
    "Status",
    "Description",
  ];
  const relatedRows = tableRowsForAll(
    results,
    "relatedPermits",
    relatedPermitsHeaders
  );
  if (relatedRows.length) {
    const ws = XLSX.utils.json_to_sheet(relatedRows);
    XLSX.utils.book_append_sheet(wb, ws, "RelatedPermits");
  }

  // --- INSPECTIONS ---
  const inspectionsHeaders = ["InspectionDetails"];
  const inspectionsRows = tableRowsForAll(
    results,
    "inspections",
    inspectionsHeaders
  );
  if (inspectionsRows.length) {
    const ws = XLSX.utils.json_to_sheet(inspectionsRows);
    XLSX.utils.book_append_sheet(wb, ws, "Inspections");
  }

  // --- CONDITIONS ---
  const conditionsHeaders = ["ConditionDetails"];
  const conditionsRows = tableRowsForAll(
    results,
    "conditions",
    conditionsHeaders
  );
  if (conditionsRows.length) {
    const ws = XLSX.utils.json_to_sheet(conditionsRows);
    XLSX.utils.book_append_sheet(wb, ws, "Conditions");
  }

  // WRITE BUFFER
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

  // DEBUG SAVE
  if (process.env.DEBUG_SAVE_XLSX === "1") {
    const outputDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `permits_full_${Date.now()}.xlsx`);
    fs.writeFileSync(filePath, buffer);
  }

  return buffer;
}

export async function saveBothellExcelBuffer(results) {
  const wb = XLSX.utils.book_new();

  const rows = results.map((r) => ({
    index: r.index,
    permitNumber: r.permitNumber,
    detailPageUrl: r.detailPageUrl,
    title: r.scrapedDetails?.title || "",
    status: r.scrapedDetails?.status || "",
    description: sanitizeCell(r.scrapedDetails?.description || ""),
    funding: r.scrapedDetails?.funding || "",
    mapImageUrl: r.scrapedDetails?.mapImageUrl || "",
    additionalImages: Array.isArray(r.scrapedDetails?.additionalImages)
      ? r.scrapedDetails.additionalImages.join(", ")
      : "",
    scrapedAt: r.scrapedDetails?.scrapedAt || "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Bothell Projects");

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return buffer;
}
