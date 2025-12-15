import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const EXCEL_SAFE_LIMIT = 32000;

function sanitizeCell(val) {
  if (val == null) return "";
  if (typeof val === "string") {
    let s = val.replace(/[\r\n\t]+/g, " ");
    return s.length > EXCEL_SAFE_LIMIT
      ? s.slice(0, EXCEL_SAFE_LIMIT) + " ...[TRUNCATED]"
      : s;
  }
  try {
    const str = JSON.stringify(val, (_, v) =>
      typeof v === "bigint" ? v.toString() : v
    );
    return str.length > EXCEL_SAFE_LIMIT
      ? str.slice(0, EXCEL_SAFE_LIMIT) + " ...[TRUNCATED]"
      : str;
  } catch {
    return String(val).slice(0, EXCEL_SAFE_LIMIT);
  }
}

function safeParse(str) {
  if (!str) return [];
  if (Array.isArray(str)) return str;

  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {}

  const cleaned = str.replace(/^\[|\]$/g, "").replace(/['"]/g, "");
  const parts = cleaned
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [str];
}

// function tableRowsForAll(results, tableKey, headers) {
//   const rows = [];
//   for (const r of results) {
//     const table = safeParse(r.scrapedDetails?.[tableKey]);
//     if (!table || table.length === 0) {
//       rows.push({
//         permitNumber: r.permitNumber,
//         detailPageUrl: r.detailPageUrl,
//       });
//       continue;
//     }
//     for (const row of table) {
//       const normalized = Array.isArray(row) ? row : Object.values(row);
//       const obj = {
//         permitNumber: r.permitNumber,
//         detailPageUrl: r.detailPageUrl,
//       };
//       headers.forEach((h, i) => {
//         obj[h] = sanitizeCell(normalized[i] ?? "");
//       });
//       rows.push(obj);
//     }
//   }
//   return rows;
// }

function tableRowsForAll(results, tableKey, headers = null) {
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

    // Dynamically set headers if not provided
    let dynamicHeaders = headers;
    if (!dynamicHeaders) {
      const firstRow = table[0];
      dynamicHeaders = Array.isArray(firstRow)
        ? firstRow.map((_, i) => `Column${i + 1}`)
        : Object.keys(firstRow);
    }

    for (const row of table) {
      const normalized = Array.isArray(row) ? row : Object.values(row);
      const obj = {
        permitNumber: r.permitNumber,
        detailPageUrl: r.detailPageUrl,
      };
      dynamicHeaders.forEach((h, i) => {
        obj[h] = sanitizeCell(normalized[i] ?? "");
      });
      rows.push(obj);
    }
  }

  return rows;
}

function addSheet(wb, rows, sheetName) {
  if (!rows.length) return;
  const ws = XLSX.utils.json_to_sheet(rows, { header: Object.keys(rows[0]) });
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

export async function saveExcelBuffer(results) {
  // results.forEach((item, idx) => {
  //   console.log("scrapedDetails:", item.scrapedDetails);
  //   console.log("-------------------");
  // });
  const wb = XLSX.utils.book_new();
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
    Description: sanitizeCell(r.scrapedDetails?.description || ""),
  }));
  addSheet(wb, mainRows, "Permits");
  // const peopleRows = tableRowsForAll(results, "people", [
  //   "Role",
  //   "Name",
  //   "License",
  // ]);
  // addSheet(wb, peopleRows, "People");
  // const feesRows = tableRowsForAll(results, "fees", [
  //   "Fee Type",
  //   "Fee Code",
  //   "Fee Amount",
  //   "Paid",
  // ]);
  // addSheet(wb, feesRows, "Fees");
  // const reviewsRows = tableRowsForAll(results, "reviews", [
  //   "Reviewer",
  //   "Review Type",
  //   "Name",
  //   "Extra1",
  //   "Status",
  //   "Date",
  //   "Extra2",
  // ]);
  // addSheet(wb, reviewsRows, "Reviews");
  // const relatedRows = tableRowsForAll(results, "relatedPermits", [
  //   "Related Type",
  //   "PermitNumber",
  //   "Status",
  //   "Description",
  // ]);
  // addSheet(wb, relatedRows, "RelatedPermits");
  // // const inspectionsHeaders = [
  // //   "Extra",
  // //   "Inspection Name",
  // //   "Date",
  // //   "Status",
  // //   "Inspector",
  // //   "Notes",
  // //   "Attachment",
  // // ];

  // // const inspectionsRows = tableRowsForAll(
  // //   results,
  // //   "inspections",
  // //   inspectionsHeaders
  // // );
  // // addSheet(wb, inspectionsRows, "Inspections");
  // // Use dynamic headers from the data itself
  // const inspectionsRows = tableRowsForAll(results, "inspections");
  // addSheet(wb, inspectionsRows, "Inspections");

  // const conditionsRows = tableRowsForAll(results, "conditions", [
  //   "ConditionDetails",
  // ]);
  // addSheet(wb, conditionsRows, "Conditions");

  const peopleRows = tableRowsForAll(results, "people"); // no static headers
  addSheet(wb, peopleRows, "People");

  const feesRows = tableRowsForAll(results, "fees"); // dynamic
  addSheet(wb, feesRows, "Fees");

  const reviewsRows = tableRowsForAll(results, "reviews"); // dynamic
  addSheet(wb, reviewsRows, "Reviews");

  const relatedRows = tableRowsForAll(results, "relatedPermits"); // dynamic
  addSheet(wb, relatedRows, "RelatedPermits");

  const inspectionsRows = tableRowsForAll(results, "inspections"); // already dynamic
  addSheet(wb, inspectionsRows, "Inspections");

  const conditionsRows = tableRowsForAll(results, "conditions"); // dynamic
  addSheet(wb, conditionsRows, "Conditions");

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  if (process.env.DEBUG_SAVE_XLSX === "1") {
    const outputDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `permits_full_${Date.now()}.xlsx`);
    fs.writeFileSync(filePath, buffer);
  }
  return buffer;
}
