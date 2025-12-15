import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import fs from "fs";
import pLimit from "p-limit";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import session from "express-session";
import bcrypt from "bcrypt";
import { fetchArcGIS } from "./lib/fetchArcGIS.js";
import { scrapePermit } from "./lib/scrapePermit.js";
import { saveExcelBuffer } from "./lib/exportExcel.js";

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(
  session({
    secret: "change_this_to_a_strong_secret", // use env var in production
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
  })
);
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  // If request is an XHR/fetch, return JSON error; otherwise redirect
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

app.post("/save-burien-json", (req, res) => {
  try {
    const filePath = path.join(__dirname, "downloads", "BurienPermit.json");

    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), "utf-8");

    res.json({ success: true, message: "JSON saved successfully!" });
  } catch (error) {
    console.error("Error writing file:", error);
    res.status(500).json({ success: false, message: "Failed to save JSON." });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "auth.html"));
});

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

  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials." });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials." });
  }

  // Auth successful — create session
  req.session.user = { username };
  res.json({
    success: true,
    message: "Login successful!",
    redirect: "/permit",
  });
});

app.get("/permit", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err)
      return res.status(500).json({ success: false, message: "Logout failed" });
    res.json({ success: true, message: "Logged out", redirect: "/" });
  });
});
// serve kirkland refresh page
app.get("/refresh-kirkland", (req, res) => {
  res.sendFile(path.join(__dirname, "kirkland-arcgis.html"));
});

// save Kirkland JSON (front-end will POST here)
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

// app.get("/", (req, res) => {
//   res.sendFile(path.join(__dirname, "index.html"));
// });

// ===== YE 12 LINES BAS ADD KARO =====
// Ye do lines kahin bhi daal do (routes ke upar ya neeche)
app.get("/refresh-burien", (req, res) => {
  res.sendFile(path.join(__dirname, "burien-arcgis.html"));
});
// =====================================

///////static permit numbers for kirkland to scrape kirkland permits as their online link is down
let permitNumbers = [
  "BLD92-01219",
  "BLD92-01218",
  "BLD92-01217",
  "BLD92-01216",
  "BLD92-01215",
  "BLD92-01214",
  "BLD92-01213",
  "BLD92-01212",
  "BLD92-01211",
  "BLD92-01210",
  "BLD02-01219",
  "BLD02-01218",
  "BLD02-01217",
  "BLD02-01216",
  "BLD02-01215",
  "BLD02-01214",
  "BLD02-01213",
  "BLD02-01212",
  "BLD02-01211",
  "BLD02-01210",
  "ADU12-01212",
  "TRE16-02333",
  "PUB18-02333",
  "PUB13-02333",
  "PSF21-02333",
  "PSF20-02333",
  "MNR23-02333",
  "LSM19-02333",
  "ESF25-02333",
  "ESF22-02333",
  "ENR24-02333",
  "ENR17-02333",
  "ELV14-02333",
  "ELV12-02333",
  "BSF15-02333",
];
app.post("/search", async (req, res) => {
  try {
    const { city, startDate, endDate, status, type, category } = req.body;

    const startTS = startDate ? new Date(startDate).getTime() : 0;
    const endTS = endDate ? new Date(endDate).getTime() : Date.now();
    const fileName = `${city.toLowerCase()}_permits.xlsx`;

    // ------------------------------
    // BURIEN (ArcGIS Driven)
    // ------------------------------
    if (city === "Burien") {
      const features = await loadPermitJSON("BurienPermit.json");

      if (!features.length) {
        return res.status(404).json({
          success: false,
          message: "No Burien permits found.",
        });
      }

      // const burienItems = features.map((f) => {
      //   const a = f.attributes || {};

      //   return {
      //     PERMITNUMBER: a.CaseNumber || "",
      //     STATUS: a.CaseStatus || "",
      //     CATEGORY: a.CaseType || "",
      //     SUPER_CATEGORY: a.Description || "",
      //     ADDRESS: a.CaseAddress || "",
      //     CREATED: a.IssuedDate ? new Date(a.IssuedDate).getTime() : 0,

      //     DETAIL_PAGE_URL: a.CaseNumber
      //       ? `https://permitsearch.mybuildingpermit.com/PermitDetails/${encodeURIComponent(
      //           a.CaseNumber
      //         )}/Burien`
      //       : "",
      //   };
      // });

      function parseDateString(str) {
        if (!str) return 0;
        const [month, day, year] = str.split("/").map(Number);
        if (!month || !day || !year) return 0;
        return new Date(year, month - 1, day).getTime();
      }
      // When mapping burienItems:
      const burienItems = features.map((f) => {
        const appliedTS = parseDateString(f.AppliedDate);

        return {
          PERMITNUMBER: f.CaseNumber || "",
          STATUS: f.CaseStatus || "",
          CATEGORY: f.CaseType || "",
          SUPER_CATEGORY: f.Description || "",
          ADDRESS: f.CaseAddress || "",
          APPLIED: appliedTS,

          DETAIL_PAGE_URL: f.CaseNumber
            ? `https://permitsearch.mybuildingpermit.com/PermitDetails/${encodeURIComponent(
                f.CaseNumber
              )}/Burien`
            : "",
        };
      });

      const filtered = burienItems.filter((item) => {
        const appliedCheck = item.APPLIED >= startTS && item.APPLIED <= endTS;

        const statusCheck =
          !status || item.STATUS.toLowerCase() === status.toLowerCase();
        const categoryCheck =
          !category ||
          item.CATEGORY.toLowerCase() === category.toLowerCase() ||
          item.SUPER_CATEGORY.toLowerCase() === category.toLowerCase();
        const typeCheck =
          !type || item.CATEGORY.toLowerCase() === type.toLowerCase();

        return appliedCheck && statusCheck && categoryCheck && typeCheck;
      });

      const urls = filtered.map((k) => k.DETAIL_PAGE_URL).filter(Boolean);
      if (!urls.length) {
        return res.status(404).json({
          success: false,
          message: "No Burien permit URLs available.",
        });
      }

      const limit = pLimit(3);
      const browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });

      const results = [];

      await Promise.allSettled(
        urls.map((url, index) =>
          limit(async () => {
            const page = await browser.newPage();
            const scraped = await scrapePermit(page, url);
            await page.close();
            results.push({
              index,
              permitNumber: filtered[index].PERMITNUMBER,
              detailPageUrl: url,
              scrapedDetails: scraped,
            });
          })
        )
      );

      await browser.close();

      results.sort((a, b) => a.index - b.index);

      const buffer = await saveExcelBuffer(results);

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`
      );
      return res.send(buffer);
    }

    // ------------------------------
    // ⭐⭐⭐ KIRKLAND (NEW - NO FILTERING)
    // ------------------------------

    // if (city === "Kirkland") {

    //   const startTS = startDate ? new Date(startDate).setHours(0, 0, 0, 0) : 0;
    //   const endTS = endDate
    //     ? new Date(endDate).setHours(23, 59, 59, 999)
    //     : Date.now();

    //   const features = await fetchArcGIS("Kirkland");

    //   if (!features.length) {
    //     return res.status(404).json({
    //       success: false,
    //       message: "No Kirkland permits found.",
    //     });
    //   }

    //   // Normalize
    //   const kirklandItems = features.map((f) => {
    //     const a = f.attributes || {};
    //     return {
    //       PERMITNUMBER: a.ticket_id || "",
    //       STATUS: a.ticket_status || "",
    //       CATEGORY: a.category || "",
    //       SUPER_CATEGORY: a.super_category || "",
    //       ADDRESS: a.ticket_detail_entry7 || "",
    //       CREATED: a.ticket_created_at
    //         ? new Date(a.ticket_created_at).getTime()
    //         : 0,
    //       DETAIL_PAGE_URL: a.ticket_detail_entry8 || "",
    //     };
    //   });
    //   const filtered = kirklandItems.filter((a) => {
    //     const createdCheck = a.CREATED >= startTS && a.CREATED <= endTS;
    //     const statusCheck =
    //       !status ||
    //       (a.STATUS && a.STATUS.toLowerCase() === status.toLowerCase());

    //     const categoryCheck =
    //       !category ||
    //       (a.CATEGORY && a.CATEGORY.toLowerCase() === category.toLowerCase()) ||
    //       (a.SUPER_CATEGORY &&
    //         a.SUPER_CATEGORY.toLowerCase() === category.toLowerCase());

    //     const typeCheck =
    //       !type ||
    //       (a.CATEGORY && a.CATEGORY.toLowerCase() === type.toLowerCase());

    //     return createdCheck && statusCheck && categoryCheck && typeCheck;
    //   });

    //   if (!filtered.length) {
    //     return res.status(404).json({
    //       success: false,
    //       message: "No Kirkland permits match filters.",
    //     });
    //   }
    //   // URLs for scraping
    //   const urls = filtered.map((k) => k.DETAIL_PAGE_URL).filter(Boolean);
    //   if (!urls.length) {
    //     return res.status(404).json({
    //       success: false,
    //       message: "No Kirkland permit URLs available.",
    //     });
    //   }
    //   const limit = pLimit(3);
    //   const browser = await puppeteer.launch({
    //     headless: "new",
    //     args: [
    //       "--no-sandbox",
    //       "--disable-setuid-sandbox",
    //       "--disable-dev-shm-usage",
    //       "--single-process",
    //       "--disable-gpu",
    //     ],
    //   });
    //   const results = [];
    //   await Promise.allSettled(
    //     urls.map((url, index) =>
    //       limit(async () => {
    //         const page = await browser.newPage();
    //         const scraped = await scrapePermit(page, url);

    //         await page.close();

    //         results.push({
    //           index,
    //           permitNumber: filtered[index].PERMITNUMBER,
    //           detailPageUrl: url,
    //           scrapedDetails: scraped,
    //         });
    //       })
    //     )
    //   );
    //   await browser.close();
    //   results.sort((a, b) => a.index - b.index);
    //   const buffer = await saveExcelBuffer(results);
    //   res.setHeader(
    //     "Content-Type",
    //     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    //   );
    //   res.setHeader(
    //     "Content-Disposition",
    //     `attachment; filename="${fileName}"`
    //   );
    //   return res.send(buffer);
    // }

    if (city === "Kirkland") {
      function parseDate(dateStr) {
        if (!dateStr) return 0;
        const [month, day, year] = dateStr.split("/").map(Number);
        return new Date(year, month - 1, day).getTime();
      }

      const startTS = new Date(startDate).setHours(0, 0, 0, 0);
      const endTS = new Date(endDate).setHours(23, 59, 59, 999);

      const features = await loadPermitJSON("KirklandPermit.json");

      const filtered = features.filter((record) => {
        const appliedTS = parseDate(record.Date_Application);
        return appliedTS >= startTS && appliedTS <= endTS;
      });

      if (!filtered.length) {
        return res.status(404).json({
          success: false,
          message: "No Kirkland permits match selected dates.",
        });
      }

      const urls = filtered.map((p) => p.moreinfo).filter(Boolean);
      if (!urls.length) {
        return res.status(404).json({
          success: false,
          message: "Filtered records have no detail URLs.",
        });
      }

      const limit = pLimit(3);
      const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox"],
      });

      const results = [];

      await Promise.allSettled(
        urls.map((url, index) =>
          limit(async () => {
            const page = await browser.newPage();
            const scraped = await scrapePermit(page, url);
            await page.close();

            results.push({
              index,
              permitNumber: filtered[index].CaseNumber,
              detailPageUrl: url,
              scrapedDetails: scraped,
            });
          })
        )
      );

      await browser.close();

      results.sort((a, b) => a.index - b.index);

      const buffer = await saveExcelBuffer(results);

      res.setHeader("Content-Type", "application/vnd.ms-excel");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`
      );

      return res.send(buffer);
    }

    function safeTS(value) {
      if (!value) return 0;
      if (/^\d+$/.test(value)) {
        return Number(value);
      }
      if (typeof value === "string" && value.includes("/")) {
        const [m, d, y] = value.split("/").map(Number);
        return new Date(y, m - 1, d).getTime();
      }
      const ts = new Date(value).getTime();
      return isNaN(ts) ? 0 : ts;
    }

    function normalizeAttributes(a, city) {
      if (city?.toLowerCase() === "bothell") {
        return {
          CITY: a.City || "Bothell",
          PERMITNUMBER: a.CaseNumber || "",
        };
      }
      return {
        CITY: a.CITY || "",
        PERMITSTATUS: a.PERMITSTATUS || "",
        PERMITTYPE: a.PERMITTYPE || a.PERMITTYPECODE || "",
        PermitCategory: a.PermitCategory || "",
        APPLIEDDATE: safeTS(a.APPLIEDDATE) || 0,
        ISSUEDDATE: safeTS(a.ISSUEDDATE) || 0,
        PERMITNUMBER: a.PERMITNUMBER
          ? encodeURIComponent(a.PERMITNUMBER)
          : a.CaseNumber,
        DETAIL_PAGE_URL: a.DETAIL_PAGE_URL || "",
      };
    }
    const featuresRaw = await fetchArcGIS(city);
    // console.log("🔥 featuresRaw:", JSON.stringify(featuresRaw.length, null, 2),"1111111111");

    if (!Array.isArray(featuresRaw)) featuresRaw = [featuresRaw];
    let flatFeatures;
    if (city?.toLowerCase() === "bothell") {
      flatFeatures = featuresRaw;
    } else {
      flatFeatures = featuresRaw.flatMap((layer) => layer.features || []);
      // console.log("🔥 featuresRaw:", JSON.stringify(flatFeatures, null, 2));
    }
    const normalized = flatFeatures.map((f) => ({
      attributes: normalizeAttributes(f.attributes || {}, city),
    }));

    //     const filtered = normalized.filter((f) => {
    //       const a = f.attributes;
    // const issuedTS = a.ISSUEDDATE && a.ISSUEDDATE !== 0
    //   ? a.ISSUEDDATE
    //   : a.APPLIEDDATE;
    //       if (issuedTS < startTS || issuedTS > endTS) return false;
    //       if (city.toLowerCase() !== "bothell") {
    //         if (issuedTS < startTS || issuedTS > endTS) return false;
    //       }
    //       if (city && a.CITY && a.CITY.toLowerCase() !== city.toLowerCase())
    //         return false;
    //       return true;
    //     });

    const filtered = normalized.filter((f) => {
      const a = f.attributes;
      if (city && ["bothell"].includes(city.toLowerCase())) {
        if (city && a.CITY && a.CITY.toLowerCase() !== city.toLowerCase())
          return false;
        return true;
      }
      const issuedTS =
        a.ISSUEDDATE && a.ISSUEDDATE !== 0 ? a.ISSUEDDATE : a.APPLIEDDATE;
      const inRange =
        issuedTS >= startTS && issuedTS <= endTS && issuedTS !== 0;

      if (!inRange) return false;

      if (city && a.CITY && a.CITY.toLowerCase() !== city.toLowerCase())
        return false;

      return true;
    });
    if (!filtered.length) {
      return res.status(404).json({
        success: false,
        message: `No permits found for ${city}.`,
      });
    }
    const concurrency2 = Math.max(
      2,
      Math.min(8, Math.floor(os.cpus().length / 2))
    );
    const limit2 = pLimit(concurrency2);

    const browser2 = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--single-process",
        "--disable-gpu",
      ],
    });
    const results2 = [];
    await Promise.allSettled(
      filtered.flatMap((feature, index) => {
        const a = feature.attributes;
        const rawPermit = a.PERMITNUMBER || a.CaseNumber || "";
        let permitNumbers = [];
        if (a.CITY?.toLowerCase() === "bothell" && rawPermit) {
          const parts = rawPermit.split(/[,;()]/).map((p) => p.trim());
          permitNumbers = parts.filter((p) => /^[A-Z]{2,}\d{4}-\d+$/.test(p));
        }
        if (a.CITY?.toLowerCase() === "bellevue" && rawPermit) {
          const possible = rawPermit.trim();
          if (possible.length >= 5) {
            permitNumbers = [possible];
          }
        }
        if (permitNumbers.length === 0) return [];
        return permitNumbers.map((permitNumber) =>
          limit2(async () => {
            const detailUrl =
              a.DETAIL_PAGE_URL ||
              `https://permitsearch.mybuildingpermit.com/PermitDetails/${permitNumber}/${city}`;
            const page = await browser2.newPage();

            let scraped = await scrapePermit(page, detailUrl);
            if (city?.toLowerCase() === "bothell") {
              const appliedDateStr = scraped.summaryRight["Applied Date"];
              const appliedTS = appliedDateStr
                ? new Date(appliedDateStr).getTime()
                : 0;

              if (!(appliedTS >= startTS && appliedTS <= endTS)) {
                return; // ❌ Skip non-matching Bothell records
              }
            }
            await page.close();
            results2.push({
              index,
              permitNumber,
              detailPageUrl: detailUrl,
              scrapedDetails: structuredClone(scraped),
            });
          })
        );
      })
    );
    await browser2.close();
    // results2.sort((a, b) => a.index - b.index);
    // let buffer2;
    // if (city?.toLowerCase() === "bothell") {
    //   buffer2 = await saveExcelBuffer(results2);
    //   res.setHeader(
    //     "Content-Disposition",
    //     `attachment; filename="${fileName}"`
    //   );
    // } else {
    //   buffer2 = await saveExcelBuffer(results2);
    //   res.setHeader(
    //     "Content-Disposition",
    //     `attachment; filename="${fileName}"`
    //   );
    // }

    // res.setHeader(
    //   "Content-Type",
    //   "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    // );
    // res.setHeader(
    //   "Content-Disposition",
    //   `attachment; filename="${fileName}"`
    // );
    // res.send(buffer2);

    results2.sort((a, b) => a.index - b.index);

    // ⛔️ If no Bothell records left after filtering → stop & show message
    if (city?.toLowerCase() === "bothell" && results2.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No matched Bothell records found for selected filters.",
      });
    }

    let buffer2 = await saveExcelBuffer(results2);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    console.log({ fileName });

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    return res.send(buffer2);
  } catch (err) {
    console.error("🔥 ROUTE ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(3000, () =>
  console.log("✅ Server running at http://localhost:3000")
);
