import XLSX from "xlsx";
import path from "path";
import fs from "fs";

function safe(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).trim();
}

function flatten(obj, prefix = "", out = {}) {
  if (!obj || typeof obj !== "object") return out;

  for (const k of Object.keys(obj)) {
    const val = obj[k];
    const key = prefix ? `${prefix}.${k}` : k;

    if (Array.isArray(val)) {
      out[key] = val.map((v) => safe(v)).join(" | ");
    } else if (typeof val === "object" && val !== null) {
      flatten(val, key, out);
    } else {
      out[key] = safe(val);
    }
  }
  return out;
}

function buildRows(results, tableKey = null) {
  const rows = [];
  const headerSet = new Set(["PermitNumber"]);

  for (const r of results) {
    if (!tableKey) {
      const base = flatten(r.identity || {});
      rows.push({
        PermitNumber: r.permitNumber,
        ...base,
      });
      Object.keys(base).forEach((k) => headerSet.add(k));
    } else {
      const table = r.scrapedDetails?.[tableKey] || [];
      for (const row of table) {
        const flat = flatten(row);
        rows.push({
          PermitNumber: r.permitNumber,
          ...flat,
        });
        Object.keys(flat).forEach((k) => headerSet.add(k));
      }
    }
  }

  return {
    headers: Array.from(headerSet),
    rows,
  };
}

function addSheet(wb, name, rows, headers) {
  if (!rows.length) return;

  const aligned = rows.map((r) => {
    const o = {};
    for (const h of headers) o[h] = safe(r[h]);
    return o;
  });

  const ws = XLSX.utils.json_to_sheet(aligned, { header: headers });
  XLSX.utils.book_append_sheet(wb, ws, name);
}

export async function saveExcelBuffer(results) {
  const wb = XLSX.utils.book_new();

  // MASTER PERMIT TABLE
  const permits = buildRows(results);
  addSheet(wb, "Permits", permits.rows, permits.headers);

  // ALL NESTED TABLES
  const tables = [
    ["people", "People"],
    ["fees", "Fees"],
    ["reviews", "Reviews"],
    ["inspections", "Inspections"],
    ["relatedPermits", "RelatedPermits"],
    ["conditions", "Conditions"],
  ];

  for (const [key, sheet] of tables) {
    const t = buildRows(results, key);
    addSheet(wb, sheet, t.rows, t.headers);
  }

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

  // optional local debug save
  if (process.env.DEBUG_SAVE_XLSX === "1") {
    const dir = path.join(process.cwd(), "output");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `permits_${Date.now()}.xlsx`), buffer);
  }

  return buffer;
}
