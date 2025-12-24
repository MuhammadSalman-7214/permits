import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import fs from "fs";
import pLimit from "p-limit";
import session from "express-session";
import bcrypt from "bcrypt";
import { fetchBothellBasic } from "./lib/fetchArcGIS.js";
import { scrapePermit } from "./lib/scrapePermit.js";
import { saveExcelBuffer } from "./lib/exportExcel.js";
import { fetchBellevueBasic } from "./lib/fetchArcGIS.js"; // adjust path

function safe(v, fallback = "") {
  return v ?? fallback;
}

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(
  session({
    secret: "change_this_to_a_strong_secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 },
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.headers.accept && req.headers.accept.includes("application/json")) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated.", redirect: "/" });
  }
  return res.redirect("/");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const usersFilePath = path.join(__dirname, "downloads/users.json");

if (!fs.existsSync(usersFilePath)) {
  fs.writeFileSync(usersFilePath, JSON.stringify([]));
}

async function loadPermitJSON(filename) {
  const filePath = path.join(__dirname, "downloads", filename);
  if (!fs.existsSync(filePath)) return [];
  const data = await fs.promises.readFile(filePath, "utf-8");
  return JSON.parse(data);
}

// === All original routes (unchanged) ===
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "auth.html")));

app.post("/signup", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: "All fields required." });
  }
  const users = JSON.parse(fs.readFileSync(usersFilePath, "utf8"));
  if (users.length > 0) {
    return res.status(403).json({
      success: false,
      message: "Signup disabled. Only one admin user allowed.",
    });
  }
  if (users.find((u) => u.username === username)) {
    return res
      .status(400)
      .json({ success: false, message: "Username already exists." });
  }
  const hashed = await bcrypt.hash(password, 10);
  users.push({ username, password: hashed });
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
  res.json({ success: true, message: "Signup successful!", redirect: "/" });
});

app.get("/check-users", (req, res) => {
  const users = JSON.parse(fs.readFileSync(usersFilePath, "utf8"));
  res.json({ canSignup: users.length === 0 });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: "All fields required." });
  }
  const users = JSON.parse(fs.readFileSync(usersFilePath, "utf8"));
  const user = users.find((u) => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials." });
  }
  req.session.user = { username };
  res.json({
    success: true,
    message: "Login successful!",
    redirect: "/permit",
  });
});

app.get("/permit", requireAuth, (req, res) =>
  res.sendFile(path.join(__dirname, "index.html"))
);

app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err)
      return res.status(500).json({ success: false, message: "Logout failed" });
    res.json({ success: true, message: "Logged out", redirect: "/" });
  });
});

app.get("/refresh-burien", (req, res) =>
  res.sendFile(path.join(__dirname, "burien-arcgis.html"))
);
app.get("/refresh-kirkland", (req, res) =>
  res.sendFile(path.join(__dirname, "kirkland-arcgis.html"))
);
// Serve Bellevue scraper HTML

app.post("/save-burien-json", (req, res) => {
  try {
    const filePath = path.join(__dirname, "downloads", "BurienPermit.json");
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), "utf-8");
    res.json({ success: true, message: "Burien JSON saved successfully!" });
  } catch (error) {
    console.error("Error writing Burien file:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to save Burien JSON." });
  }
});

app.post("/save-kirkland-json", (req, res) => {
  try {
    const filePath = path.join(__dirname, "downloads", "KirklandPermit.json");
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), "utf-8");
    res.json({ success: true, message: "Kirkland JSON saved successfully!" });
  } catch (error) {
    console.error("Error writing Kirkland file:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to save Kirkland JSON." });
  }
});
app.get("/api/bellevue", async (req, res) => {
  try {
    const data = await fetchBellevueBasic();
    res.json({
      success: true,
      count: data.length,
    });
  } catch (err) {
    console.error("Bellevue API error:", err.message);
    res.status(500).json({
      success: false,
      count: 0,
      message: err.message,
    });
  }
});
app.get("/api/bothell", async (req, res) => {
  try {
    const data = await fetchBothellBasic("bothell");
    res.json({
      success: true,
      count: data.length,
    });
  } catch (err) {
    console.error("Bellevue API error:", err.message);
    res.status(500).json({
      success: false,
      count: 0,
      message: err.message,
    });
  }
});

function normalizeParcel(parcel) {
  if (!parcel) return "";
  let p = String(parcel).replace(/\s+/g, "").replace(/^-/, "");
  if (/^\d{10}$/.test(p)) p = p.replace(/^(\d{6})(\d{4})$/, "$1-$2");
  return p;
}

function formatDate(d) {
  if (!d) return "";

  // Bellevue numeric timestamp
  if (typeof d === "number") {
    const dt = new Date(d);
    return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`;
  }

  // ISO dates (2025-01-31)
  if (d.includes("-")) {
    const dt = new Date(d);
    return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`;
  }

  // Already mm/dd/yyyy
  if (typeof d === "string" && d.includes("/")) {
    return d;
  }

  return "";
}

const limit = pLimit(8);
// const CACHE_DIR = path.join(__dirname, "cache");
// if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

app.post("/search", async (req, res) => {
  const { city, startDate, endDate } = req.body;

  if (!city || !startDate || !endDate) {
    return res
      .status(400)
      .json({ success: false, message: "Missing parameters." });
  }

  const cityFileMap = {
    bellevue: "BellevuePermit.json",
    kirkland: "KirklandPermit.json",
    burien: "BurienPermit.json",
    bothell: "BothellPermit.json",
  };

  const filename = cityFileMap[city.toLowerCase()];
  if (!filename)
    return res
      .status(400)
      .json({ success: false, message: "Unsupported city." });
  // function getApplicationDate(rec) {
  //   return rec.Date_Application || rec.AppliedDate || rec.ApplicationDate || "";
  // }

  function getApplicationDate(rec) {
    return (
      rec.APPLIEDDATE ||
      rec.AppliedDate ||
      rec.Date_Application ||
      rec.ApplicationDate ||
      ""
    );
  }

  function parseUSDate(d) {
    if (!d) return null;

    // Bellevue timestamp
    if (typeof d === "number") return new Date(d);

    if (d.includes("-")) return new Date(d);

    if (d.includes("/")) {
      const [m, day, y] = d.split("/");
      return new Date(y, m - 1, day);
    }

    return null;
  }

  function normalizeArcGISDate(val) {
    if (!val) return null;

    // 1️⃣ Epoch milliseconds (Bellevue, Bothell, Burien)
    if (typeof val === "number") {
      return new Date(val);
    }

    // 2️⃣ ISO or RFC strings
    if (typeof val === "string" && val.includes("T")) {
      const d = new Date(val);
      return isNaN(d) ? null : d;
    }

    // 3️⃣ US date string MM/DD/YYYY
    if (typeof val === "string" && val.includes("/")) {
      const [m, d, y] = val.split("/");
      return new Date(`${y}-${m}-${d}`);
    }

    return null;
  }

  const features = await loadPermitJSON(filename);

  const start = new Date(startDate);
  const end = new Date(endDate);

  let matched = [];

  if (city.toLowerCase() === "bothell") {
    matched = features
      .filter((rec) => rec.CaseNumber || rec.PermitNumber) // only records with CaseNumber or PermitNumber
      .flatMap((rec) => {
        const caseNumbers = (rec.CaseNumber || rec.PermitNumber)
          .split(",") // split multiple case numbers
          .map((cn) => cn.trim()) // remove extra spaces
          .filter(Boolean); // remove empty strings

        // Log each case number separately
        caseNumbers.forEach((cn) => console.log("Bothell case number:", cn));

        // Create a separate record for each case number
        return caseNumbers.map((cn) => ({
          ...rec,
          CaseNumber: cn, // overwrite with individual case number
        }));
      });
  } else {
    const start = new Date(startDate);
    const end = new Date(endDate);

    matched = features.filter((rec) => {
      const raw = getApplicationDate(rec);
      const d = normalizeArcGISDate(raw);
      if (!d) return false;
      return d >= start && d <= end;
    });
  }
  if (!matched.length)
    return res
      .status(404)
      .json({ success: false, message: "No permits found." });

  const tasks = matched.map((rec) =>
    limit(async () => {
      const scraped = await scrapePermit(rec, city);
      if (!scraped) return null;

      let identity = {};
      if (city.toLowerCase() === "kirkland") {
        identity = {
          projectName: safe(rec.ProjectName),
          PermitUrl: safe(
            `https://permitsearch.mybuildingpermit.com/PermitDetails/${scraped.permitNumber}/${city}`
          ),
          jurisdiction: city,
          type: safe(rec.Prefix || rec.GISPermitType),
          address: safe(rec.SiteAddress),
          parcel: normalizeParcel(rec.SiteParcelNumber),
          status: safe(rec.CaseStatus),
          appliedDate: formatDate(rec.Date_Application),
          applicationExpiration: formatDate(rec.Date_Expires),
          issuedDate: formatDate(rec.Date_Issued),
          finaledDate: formatDate(rec.Date_Finaled),
          permitExpiration: formatDate(rec.Date_Expires),
          description: safe(rec.CaseDescription),
        };
      } else if (city.toLowerCase() === "burien") {
        identity = {
          projectName: safe(rec.ProjectType || rec.CaseType), // fallback to CaseType if ProjectType missing
          PermitUrl: safe(
            `https://permitsearch.mybuildingpermit.com/PermitDetails/${scraped.permitNumber}/${city}`
          ),
          jurisdiction: city,
          type: safe(rec.CaseType),
          address: safe(rec.CaseAddress),
          parcel: normalizeParcel(rec.SiteParcelNumber),
          status: safe(rec.CaseStatus),
          appliedDate: formatDate(rec.AppliedDate),
          applicationExpiration: formatDate(rec.ExpiredDate),
          issuedDate: formatDate(rec.IssuedDate),
          finaledDate: "", // Burien doesn't have Date_Finaled
          permitExpiration: formatDate(rec.ExpiredDate),
          description: safe(rec.Description),
        };
      } else if (city.toLowerCase() === "bellevue") {
        identity = {
          projectName: safe(rec.PermitSubCategory || rec.SUBTYPE),
          PermitUrl: safe(
            rec.MBPSTATUSSITE ||
              `https://permitsearch.mybuildingpermit.com/PermitDetails/${scraped.permitNumber}/${city}`
          ),
          jurisdiction: "Bellevue",
          type: safe(rec.PERMITTYPEDESCRIPTION || rec.PERMITTYPE),
          address: safe(rec.SITEADDRESS),
          parcel: normalizeParcel(rec.PARCELNUMBER),
          status: safe(rec.PERMITSTATUS || rec.STATUSGROUP),
          appliedDate: formatDate(rec.APPLIEDDATE),
          issuedDate: formatDate(rec.ISSUEDDATE),
          finaledDate: "",
          permitExpiration: "",
          applicationExpiration: "",
          description: safe(rec.WORKTYPE || rec.SUBTYPE),
        };
      } else if (city.toLowerCase() === "bothell") {
        // ✅ For Bothell: include all fields from the record
        identity = {
          projectName: safe(rec.ProjectName),
          PermitUrl: `https://permitsearch.mybuildingpermit.com/PermitDetails/${scraped.permitNumber}/${city}`,
          CaseNumber: safe(rec.CaseNumber),
          Status: safe(rec.Status),
          ProjectDescription: safe(rec.ProjectDescription),
          ContactPhone: safe(rec.ContactPhone),
          GlobalID: safe(rec.GlobalID),
          CityContact: safe(rec.CityContact),
          ProjectType: safe(rec.ProjectType),
          jurisdiction: city,
        };
      }
      return {
        permitNumber: scraped.permitNumber,
        detailPageUrl: scraped.detailPageUrl,
        identity,
        scrapedDetails: scraped.scrapedDetails,
      };
    })
  );

  const results = (await Promise.all(tasks)).filter(Boolean);

  const excelBuffer = await saveExcelBuffer(results);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=${city}_permits_${Date.now()}.xlsx`
  );
  res.send(excelBuffer);
});

app.listen(3000, () =>
  console.log("✅ Server running at http://localhost:3000")
);
