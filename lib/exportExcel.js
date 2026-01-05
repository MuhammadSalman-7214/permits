import XLSX from "xlsx";

/**
 * Super-fast value cleaner.
 * Avoids JSON.stringify which is very slow in large loops.
 */
function ultraFastSafe(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    // If it's an array of strings/numbers, join them.
    // Otherwise, just label it [Object] to save time/memory.
    if (Array.isArray(v)) return v.length > 0 ? "Multiple Records" : "";
    return "[Details]";
  }
  return String(v).trim();
}

/**
 * Builds sheet data by only extracting flat properties.
 * This prevents the "stuck" behavior during RelatedPermits processing.
 */
function processToSheet(results, type = "identity") {
  const rows = [];
  const headerSet = new Set(["PermitNumber"]);

  for (const r of results) {
    const permitNum = r.permitNumber;

    if (type === "identity") {
      const data = r.identity || {};
      const row = { PermitNumber: permitNum };
      for (const k in data) {
        if (Object.prototype.hasOwnProperty.call(data, k)) {
          row[k] = ultraFastSafe(data[k]);
          headerSet.add(k);
        }
      }
      rows.push(row);
    } else {
      const nestedData = r.scrapedDetails?.[type];
      if (!Array.isArray(nestedData) || nestedData.length === 0) continue;

      for (const item of nestedData) {
        const row = { PermitNumber: permitNum };
        for (const k in item) {
          if (Object.prototype.hasOwnProperty.call(item, k)) {
            // Only take the first level of data.
            // If the property is another object, ultraFastSafe handles it.
            row[k] = ultraFastSafe(item[k]);
            headerSet.add(k);
          }
        }
        rows.push(row);

        // Safety break: Excel becomes unstable after ~500k rows across sheets
        if (rows.length > 100000) break;
      }
    }
  }

  if (rows.length === 0) return null;

  // Use XLSX utility to convert the array of objects to a worksheet
  return XLSX.utils.json_to_sheet(rows, { header: Array.from(headerSet) });
}

export async function saveExcelBuffer(results) {
  console.log("📊 Starting Excel construction...");
  const wb = XLSX.utils.book_new();

  // 1. Master Permits Sheet
  const masterSheet = processToSheet(results, "identity");
  if (masterSheet) {
    XLSX.utils.book_append_sheet(wb, masterSheet, "Permits");
    console.log("✅ Master sheet done");
  }

  // 2. Nested Tables
  const tables = [
    ["people", "People"],
    ["fees", "Fees"],
    ["reviews", "Reviews"],
    ["inspections", "Inspections"],
    ["relatedPermits", "RelatedPermits"], // This was the crash point
    ["conditions", "Conditions"],
  ];

  for (const [key, sheetName] of tables) {
    console.log(`📝 Processing sheet: ${sheetName}...`);
    const ws = processToSheet(results, key);
    if (ws) {
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      console.log(`✅ ${sheetName} done`);
    }
  }

  console.log("💾 Finalizing Workbook Buffer...");

  // Write with NO compression first to see if it speeds up.
  // Compression takes a lot of CPU for 100k+ rows.
  const buffer = XLSX.write(wb, {
    bookType: "xlsx",
    type: "buffer",
    compression: false,
  });

  return buffer;
}
