import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import os from "os";
import pLimit from "p-limit";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import burienPermitData from "./downloads/BurienPermit.json" with { type: "json" };


import { fetchArcGIS, fetchBurienPermits } from "./lib/fetchArcGIS.js";
import {
  scrapeBurienPermit,
  scrapePermit,
  scrapeProject,
} from "./lib/scrapePermit.js";
import { saveBothellExcelBuffer, saveExcelBuffer } from "./lib/exportExcel.js";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 3000;

const stealth = StealthPlugin();
stealth.enabledEvasions.delete("chrome.runtime");
stealth.enabledEvasions.delete("iframe.contentWindow");
puppeteer.use(stealth);

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
let permitNumbers = ["BLD92-01219","BLD92-01218","BLD92-01217","BLD92-01216","BLD92-01215","BLD92-01214","BLD92-01213","BLD92-01212","BLD92-01211","BLD92-01210","BLD02-01219","BLD02-01218","BLD02-01217","BLD02-01216","BLD02-01215","BLD02-01214","BLD02-01213","BLD02-01212","BLD02-01211","BLD02-01210","ADU12-01212","TRE16-02333","PUB18-02333","PUB13-02333","PSF21-02333","PSF20-02333","MNR23-02333","LSM19-02333","ESF25-02333","ESF22-02333","ENR24-02333","ENR17-02333","ELV14-02333","ELV12-02333","BSF15-02333"]
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
      const features = burienPermitData;
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

  const statusCheck = !status || item.STATUS.toLowerCase() === status.toLowerCase();
  const categoryCheck =
    !category || item.CATEGORY.toLowerCase() === category.toLowerCase() || item.SUPER_CATEGORY.toLowerCase() === category.toLowerCase();
  const typeCheck = !type || item.CATEGORY.toLowerCase() === type.toLowerCase();

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
  headless: "new",                      // safer than true
  executablePath: process.env.CHROME_PATH,
    ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-zygote',
    '--disable-web-security',
  ],
});

      const results = [];

      await Promise.allSettled(
        urls.map((url, index) =>
          limit(async () => {
            await new Promise(r => setTimeout(r, 300));
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
        `attachment; filename="${fileName}"`      );
      return res.send(buffer);
    }

    // ------------------------------
    // ⭐⭐⭐ KIRKLAND (NEW - NO FILTERING)
    // ------------------------------

    if (city === "Kirkland") {
      
      const startTS = startDate ? new Date(startDate).setHours(0, 0, 0, 0) : 0;
      const endTS = endDate
        ? new Date(endDate).setHours(23, 59, 59, 999)
        : Date.now();

      const features = await fetchArcGIS("Kirkland");

      if (!features.length) {
        return res.status(404).json({
          success: false,
          message: "No Kirkland permits found.",
        });
      }

      // Normalize
      const kirklandItems = features.map((f) => {
        const a = f.attributes || {};
        return {
          PERMITNUMBER: a.ticket_id || "",
          STATUS: a.ticket_status || "",
          CATEGORY: a.category || "",
          SUPER_CATEGORY: a.super_category || "",
          ADDRESS: a.ticket_detail_entry7 || "",
          CREATED: a.ticket_created_at
            ? new Date(a.ticket_created_at).getTime()
            : 0,
          DETAIL_PAGE_URL: a.ticket_detail_entry8 || "",
        };
      });
      const filtered = kirklandItems.filter((a) => {
        const createdCheck = a.CREATED >= startTS && a.CREATED <= endTS;
        const statusCheck =
          !status ||
          (a.STATUS && a.STATUS.toLowerCase() === status.toLowerCase());

        const categoryCheck =
          !category ||
          (a.CATEGORY && a.CATEGORY.toLowerCase() === category.toLowerCase()) ||
          (a.SUPER_CATEGORY &&
            a.SUPER_CATEGORY.toLowerCase() === category.toLowerCase());

        const typeCheck =
          !type ||
          (a.CATEGORY && a.CATEGORY.toLowerCase() === type.toLowerCase());

        return createdCheck && statusCheck && categoryCheck && typeCheck;
      });

      if (!filtered.length) {
        return res.status(404).json({
          success: false,
          message: "No Kirkland permits match filters.",
        });
      }
      // URLs for scraping
      const urls = filtered.map((k) => k.DETAIL_PAGE_URL).filter(Boolean);
      if (!urls.length) {
        return res.status(404).json({
          success: false,
          message: "No Kirkland permit URLs available.",
        });
      }
      const limit = pLimit(3);
    const browser = await puppeteer.launch({
  headless: "new",                      // safer than true
  executablePath: process.env.CHROME_PATH,
    ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-zygote',
    '--disable-web-security',
  ],
});
      const results = [];
      await Promise.allSettled(
        urls.map((url, index) =>
          limit(async () => {
            await new Promise(r => setTimeout(r, 300));

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
// console.log({a});
if (city && ["bothell"].includes(city.toLowerCase())) {
    if (city && a.CITY && a.CITY.toLowerCase() !== city.toLowerCase())
      return false;
    return true;
  }
  const issuedTS =
    a.ISSUEDDATE && a.ISSUEDDATE !== 0
      ? a.ISSUEDDATE
      : a.APPLIEDDATE;
  const inRange =
    issuedTS >= startTS &&
    issuedTS <= endTS &&
    issuedTS !== 0;

  if (!inRange) return false;

  if (city && a.CITY && a.CITY.toLowerCase() !== city.toLowerCase())
    return false;

  return true;
});

// console.log("🔥 filtered:", JSON.stringify(filtered.length, null, 2));
    
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
  headless: "new",                      // safer than true
  executablePath: process.env.CHROME_PATH,
    ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-zygote',
    '--disable-web-security',
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
              await new Promise(r => setTimeout(r, 300));

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
        console.log({scraped});
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
res.setHeader(
  "Content-Disposition",
  `attachment; filename="${fileName}"`
);

return res.send(buffer2);

  } catch (err) {
    console.error("🔥 ROUTE ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
