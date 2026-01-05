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
import { fetchBellevueBasic } from "./lib/fetchArcGIS.js";
import * as dotenv from "dotenv"; // Import dotenv
dotenv.config();
function safe(v, fallback = "") {
  return v ?? fallback;
}
const PORT = process.env.PORT || 3000; // Reads from environment or defaults to 3000
const app = express();
app.use(express.json({ limit: "100mb" })); // Increased for large payloads
app.use(express.urlencoded({ limit: "100mb", extended: true }));

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
    return res.status(401).json({
      success: false,
      message: "Your session has expired. Please log in again.",
      redirect: "/",
    });
  }
  return res.redirect("/");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const usersFilePath = path.join(__dirname, "downloads/users.json");

if (!fs.existsSync(usersFilePath)) {
  if (!fs.existsSync(path.join(__dirname, "downloads"))) {
    fs.mkdirSync(path.join(__dirname, "downloads"));
  }
  fs.writeFileSync(usersFilePath, JSON.stringify([]));
}

async function loadPermitJSON(filename) {
  const filePath = path.join(__dirname, "downloads", filename);
  if (!fs.existsSync(filePath)) return null; // Return null if file is missing
  const data = await fs.promises.readFile(filePath, "utf-8");
  return JSON.parse(data);
}

// === Auth Routes ===
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "auth.html")));

app.post("/signup", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res
      .status(400)
      .json({ success: false, message: "All fields required." });
  const users = JSON.parse(fs.readFileSync(usersFilePath, "utf8"));
  if (users.length > 0)
    return res
      .status(403)
      .json({ success: false, message: "Signup disabled." });
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
  const users = JSON.parse(fs.readFileSync(usersFilePath, "utf8"));
  const user = users.find((u) => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({
      success: false,
      message: "The username or password you entered is incorrect.",
    });
  }
  req.session.user = { username };
  res.json({
    success: true,
    message: "Welcome back! Redirecting...",
    redirect: "/permit",
  });
});

app.get("/permit", requireAuth, (req, res) =>
  res.sendFile(path.join(__dirname, "index.html"))
);

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true, redirect: "/" }));
});

// === Data Management Routes ===
app.get("/refresh-burien", (req, res) =>
  res.sendFile(path.join(__dirname, "burien-arcgis.html"))
);
app.get("/refresh-kirkland", (req, res) =>
  res.sendFile(path.join(__dirname, "kirkland-arcgis.html"))
);

app.post("/save-burien-json", (req, res) => {
  try {
    fs.writeFileSync(
      path.join(__dirname, "downloads", "BurienPermit.json"),
      JSON.stringify(req.body, null, 2)
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

app.post("/save-kirkland-json", (req, res) => {
  try {
    fs.writeFileSync(
      path.join(__dirname, "downloads", "KirklandPermit.json"),
      JSON.stringify(req.body, null, 2)
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

app.get("/api/bellevue", async (req, res) => {
  try {
    const data = await fetchBellevueBasic();
    res.json({ success: true, count: data.length });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "We couldn't reach the Bellevue database right now.",
    });
  }
});

app.get("/api/bothell", async (req, res) => {
  try {
    const data = await fetchBothellBasic("bothell", 3);

    // You MUST save the data to a file so the Search route can find it later
    const filePath = path.join(__dirname, "downloads", "BothellPermit.json");
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    res.json({ success: true, count: data.length });
  } catch (err) {
    console.error("Bothell Refresh Error:", err);
    res.status(500).json({
      success: false,
      message: "We couldn't reach the Bothell database right now.",
    });
  }
});

// === Helper Functions ===
function normalizeParcel(parcel) {
  if (!parcel) return "";
  let p = String(parcel).replace(/\s+/g, "").replace(/^-/, "");
  if (/^\d{10}$/.test(p)) p = p.replace(/^(\d{6})(\d{4})$/, "$1-$2");
  return p;
}

function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`;
}

function normalizeArcGISDate(val) {
  if (!val) return null;
  if (typeof val === "number") return new Date(val);
  if (typeof val === "string" && val.includes("/")) {
    const [m, d, y] = val.split("/");
    return new Date(`${y}-${m}-${d}`);
  }
  const d = new Date(val);
  return isNaN(d) ? null : d;
}

function getApplicationDate(rec) {
  return (
    rec.APPLIEDDATE ||
    rec.AppliedDate ||
    rec.Date_Application ||
    rec.ApplicationDate ||
    ""
  );
}

let searchProgress = {
  current: 0,
  total: 0,
  status: "idle", // idle, fetching, generating, complete
};
// === UPDATE THIS SECTION ===
app.get("/progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Change interval from 1000 to 100 for smoother updates
  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify(searchProgress)}\n\n`);
    if (searchProgress.status === "complete") {
      clearInterval(interval);
    }
  }, 100); // 100ms is much smoother

  req.on("close", () => clearInterval(interval));
});
// === OPTIMIZED SEARCH ROUTE ===
const CONCURRENCY_LIMIT = 50; // High speed network concurrency
const MEMORY_BATCH_SIZE = 500; // Process 500 permits at a time to prevent RAM crashes

app.post("/search", async (req, res) => {
  const { city, startDate, endDate } = req.body;
  if (!city || !startDate || !endDate)
    return res
      .status(400)
      .json({ message: "Please fill in all the search filters." });
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
      .json({ message: "We don't have data for that city yet." });
  const features = await loadPermitJSON(filename);
  if (features === null) {
    return res.status(400).json({
      success: false,
      message: `The data for ${city} hasn't been downloaded yet. Please click the "Refresh ${city} Data" button on the right first.`,
    });
  }
  const start = new Date(startDate);
  const end = new Date(endDate);

  let matched = [];
  if (city.toLowerCase() === "bothell") {
    matched = features
      .filter((rec) => rec.CaseNumber || rec.PermitNumber)
      .flatMap((rec) => {
        const nums = (rec.CaseNumber || rec.PermitNumber)
          .split(",")
          .map((cn) => cn.trim())
          .filter(Boolean);
        return nums.map((cn) => ({ ...rec, CaseNumber: cn }));
      });
  } else {
    matched = features.filter((rec) => {
      const d = normalizeArcGISDate(getApplicationDate(rec));
      return d && d >= start && d <= end;
    });
  }

  if (!matched.length)
    return res.status(404).json({
      message: "No permits found for those dates. Try a wider range?",
    });
  searchProgress = { current: 0, total: matched.length, status: "fetching" };
  const limit = pLimit(CONCURRENCY_LIMIT);
  let allResults = [];

  // CHUNKING LOGIC: Process in batches to prevent Node.js from "freezing"
  for (let i = 0; i < matched.length; i += MEMORY_BATCH_SIZE) {
    const chunk = matched.slice(i, i + MEMORY_BATCH_SIZE);
    console.log(
      `📦 Processing chunk ${
        Math.floor(i / MEMORY_BATCH_SIZE) + 1
      } of ${Math.ceil(matched.length / MEMORY_BATCH_SIZE)}`
    );

    const chunkTasks = chunk.map((rec) =>
      limit(async () => {
        try {
          const scraped = await scrapePermit(rec, city);
          searchProgress.current++;
          if (!scraped) return null;

          let identity = {};
          const c = city.toLowerCase();

          if (c === "kirkland") {
            identity = {
              projectName: safe(rec.ProjectName),
              PermitUrl: `https://permitsearch.mybuildingpermit.com/PermitDetails/${scraped.permitNumber}/${city}`,
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
          } else if (c === "burien") {
            identity = {
              projectName: safe(rec.ProjectType || rec.CaseType),
              PermitUrl: `https://permitsearch.mybuildingpermit.com/PermitDetails/${scraped.permitNumber}/${city}`,
              jurisdiction: city,
              type: safe(rec.CaseType),
              address: safe(rec.CaseAddress),
              parcel: normalizeParcel(rec.SiteParcelNumber),
              status: safe(rec.CaseStatus),
              appliedDate: formatDate(rec.AppliedDate),
              applicationExpiration: formatDate(rec.ExpiredDate),
              issuedDate: formatDate(rec.IssuedDate),
              description: safe(rec.Description),
            };
          } else if (c === "bellevue") {
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
              description: safe(rec.WORKTYPE || rec.SUBTYPE),
            };
          } else if (c === "bothell") {
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
        } catch (err) {
          searchProgress.current++;
          return null;
        }
      })
    );

    const chunkResults = await Promise.all(chunkTasks);
    allResults.push(...chunkResults.filter(Boolean));
    searchProgress.current = allResults.length;
    // Explicit Memory Cleanup hint for Node
    if (global.gc) global.gc();
  }
  searchProgress.status = "generating";
  console.log(
    `✅ Fetching complete. Generating Excel for ${allResults.length} records...`
  );

  const excelBuffer = await saveExcelBuffer(allResults);
  searchProgress.status = "complete";
  // Clear reference to free up memory before response finishes
  allResults = null;

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

app.listen(PORT, () =>
  console.log(`✅ Server running at http://localhost:${PORT}`)
);
