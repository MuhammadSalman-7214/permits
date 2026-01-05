// import axios from "axios";

// export async function fetchArcGIS(city, maxRetries = 5) {
//   let attempt = 0;
//   const CITY_ARC_URLS = {
//     Bellevue:
//       "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Permits/MapServer/66/query",

//     Bothell:
//       "https://services1.arcgis.com/yWC3RwGqrp7oLKhO/arcgis/rest/services/PW_CD_CombinedProjects_view/FeatureServer/33/query",
//     Kirkland:
//       "https://kirklandactivitymap.connect.socrata.com/api/tickets/details.json?categories=5:886,893-894,896,898,900,905-907,909,911-912,914-917%7C6:852-857,864-866,869,877,883-885%7C8:918-919&end_date=2025-11-14&lat1=47.72995711800415&lat2=47.681241110257716&lng1=-122.06381086885607&lng2=-122.3085188430582&search_field=&search_value=&shape_group_id=2xwv-rz4w&shape_ids=&start_date=2023-11-25&statusFilter=&zoom=12",
//     // Add more cities here
//     // "Auburn": "...",
//     // "Kenmore": "...",
//   };
//   const ARC_URL = CITY_ARC_URLS[city] || CITY_ARC_URLS["Bellevue"];

//   while (attempt < maxRetries) {
//     try {
//       if (city === "Kirkland") {
//         const response = await axios.get(CITY_ARC_URLS[city], {
//           timeout: 60000,
//         });
//         const records = response.data?.api_data?.records || [];
//         return records.map((r) => ({
//           attributes: r,
//         }));
//       }

//       const response = await axios.get(ARC_URL, {
//         timeout: 60000,
//         params: {
//           where: "1=1",
//           outFields: "*",
//           f: "json",
//           returnGeometry: true,
//           resultOffset: 0,
//           resultRecordCount: 1000,
//         },
//       });
//       if (!response.data.features) throw new Error("No features in response");
//       return response.data.features;
//     } catch (err) {
//       attempt++;

//       console.log(
//         `❌ ArcGIS request failed (attempt ${attempt}): ${err.message}`
//       );

//       if (attempt >= maxRetries) {
//         console.log("⛔ Max retries reached. Throwing error.");
//         throw err;
//       }

//       // ✅ Exponential backoff
//       const wait = 2000 * attempt;
//       console.log(`⏳ Waiting ${wait}ms before retry...`);
//       await new Promise((res) => setTimeout(res, wait));
//     }
//   }
// }

import axios from "axios";
import fs from "fs";
import path from "path";

const CITY_ARC_URLS = {
  Bellevue:
    "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Permits/MapServer/66/query",

  Bothell:
    "https://services1.arcgis.com/yWC3RwGqrp7oLKhO/arcgis/rest/services/PW_CD_CombinedProjects_view/FeatureServer/33/query",
  Kirkland:
    "https://maps.kirklandwa.gov/appx/rest/services/StreetSmart_TRN_RoadAlerts/FeatureServer/1?f=json",
  Burien:
    "https://gis.burienwa.gov/server/rest/services/cwpll/cwpll_caseactivity/MapServer/1/query",
};
export async function fetchArcGIS(city, maxRetries = 5) {
  if (city !== "Bellevue") {
    return fetchSingleArcGIS(city, maxRetries);
  }
  const BASE_URL =
    "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Permits/MapServer";

  try {
    // 1️⃣ Fetch all layer IDs
    const layerInfo = await axios.get(`${BASE_URL}?f=pjson`);
    const layers = layerInfo.data.layers || [];

    const layerIds = layers.map((l) => l.id);

    const allFeatures = [];

    // 2️⃣ Loop all layer IDs and fetch data for each layer
    for (const id of layerIds) {
      try {
        const response = await axios.get(`${BASE_URL}/${id}/query`, {
          params: {
            where: "1=1",
            outFields: "*",
            f: "json",
            returnGeometry: true,
            resultOffset: 0,
            resultRecordCount: 2000,
          },
        });

        const features = response.data.features || [];
        console.log({ features });

        allFeatures.push({
          layerId: id,
          layerName: layers.find((l) => l.id === id)?.name,
          features,
        });
      } catch (layerErr) {
        console.log(`⚠️ Failed layer ${id}: ${layerErr.message}`);
      }
    }

    return allFeatures;
  } catch (error) {
    console.log("❌ Bellevue fetch error:", error.message);
    throw error;
  }
}

// fallback for other cities
// async function fetchSingleArcGIS(city, maxRetries) {
//   const ARC_URL = CITY_ARC_URLS[city] || CITY_ARC_URLS["Bellevue"];
//   let attempt = 0;

//   while (attempt < maxRetries) {
//     try {
//       const response = await axios.get(ARC_URL, {
//         params: {
//           where: "1=1",
//           outFields: "*",
//           f: "json",
//           returnGeometry: true,
//         },
//       });
//       return response.data.features;
//     } catch (err) {
//       attempt++;
//       if (attempt >= maxRetries) throw err;
//     }
//   }
// }

async function fetchSingleArcGIS(city, maxRetries) {
  const ARC_URL = CITY_ARC_URLS[city] || CITY_ARC_URLS["Bellevue"];
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await axios.get(ARC_URL, {
        params: {
          where: "1=1",
          outFields: "*",
          f: "json",
          returnGeometry: true,
        },
      });

      if (city === "Kirkland") {
        const records = response.data?.api_data?.records || [];

        return records.map((r) => ({ attributes: r }));
      }
      if (city === "Bothell") {
        const features = response.data?.features || [];

        return features.map((f) => ({
          attributes: {
            CaseNumber: f.attributes?.CaseNumber || null,
            CITY: "Bothell",
          },
        }));
      }

      return response.data.features;
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) throw err;
    }
  }
}
// export async function fetchBurienPermits(maxRetries = 5) {
//   const url =
//     "https://gis.burienwa.gov/server/rest/services/cwpll/cwpll_caseactivity/MapServer/0/query";

//   const params = {
//     where: "1=1",
//     outFields: "*",
//     f: "json",
//     resultOffset: 0,
//     resultRecordCount: 1000,
//   };

//   let attempt = 0;

//   while (attempt < maxRetries) {
//     try {
//       const response = await axios.get(
//         "https://gis.burienwa.gov/server/rest/services/cwpll/cwpll_caseactivity/MapServer/0/query",
//         {
//           params: {
//             where: "CaseStatus = 'CLOSED' OR CaseStatus = 'ISSUED'",
//             outFields: "*",
//             f: "json",
//             resultOffset: 0,
//             resultRecordCount: 1000,
//           },
//           headers: {
//             Referer: "https://gis.burienwa.gov/",
//             "User-Agent":
//               "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
//             Accept: "application/json, text/plain, */*",
//           },
//           timeout: 120000, // 2 minutes
//         }
//       );

//       const data = response.data;
//       return data.features || [];
//     } catch (err) {
//       attempt++;
//       console.log(`❌ Burien fetch attempt ${attempt} failed: ${err.message}`);
//       if (attempt >= maxRetries) throw err;
//       await new Promise((res) => setTimeout(res, 2000 * attempt)); // exponential backoff
//     }
//   }
// }

export async function fetchBurienPermits({ startTS, endTS }) {
  const url = `https://services.arcgis.com/.../Burien/.../FeatureServer/0/query?where=1%3D1&outFields=*&f=json`;

  const res = await fetch(url);
  const json = await res.json();

  return json.features.filter((f) => {
    const a = f.attributes || {};
    const created = a.IssuedDate ? new Date(a.IssuedDate).getTime() : 0;
    return created >= startTS && created <= endTS;
  });
}

// export async function fetchBellevueBasic() {
//   const BASE_URL =
//     "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Permits/MapServer/66";
//   const FEATURE_URL = `${BASE_URL}/query`;

//   try {
//     // Fetch layer metadata to get field names dynamically
//     const layerResponse = await axios.get(`${BASE_URL}?f=json`);
//     const fields = layerResponse.data.fields.map((f) => f.name).join(",");

//     if (!fields) throw new Error("No fields found in layer metadata");

//     const response = await axios.get(FEATURE_URL, {
//       params: {
//         where: "1=1",
//         outFields: fields, // Use explicit fields instead of "*"
//         f: "json",
//         returnGeometry: false,
//         resultRecordCount: 2000, // Max supported by this layer
//       },
//     });

//     const features = response.data.features || [];
//     const data = features.map((f) => f.attributes);

//     console.log("Fetched Bellevue basic records:", data.length);

//     // Save directly to project folder (no browser download needed)
//     const downloadPath = path.join(
//       process.cwd(),
//       "downloads",
//       "BellevuePermit.json"
//     );
//     if (!fs.existsSync(path.dirname(downloadPath)))
//       fs.mkdirSync(path.dirname(downloadPath), { recursive: true });
//     fs.writeFileSync(downloadPath, JSON.stringify(data, null, 2), "utf-8");
//     console.log("Saved Bellevue data to:", downloadPath);

//     return data;
//   } catch (err) {
//     console.error("Failed to fetch Bellevue data:", err.message);
//     return [];
//   }
// }
export async function fetchBellevueBasic() {
  const BASE_URL =
    "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Permits/MapServer";

  try {
    const layerInfo = await axios.get(`${BASE_URL}?f=pjson`);
    const layers = layerInfo.data.layers || [];

    let allRecords = [];

    for (const layer of layers) {
      let offset = 0;
      const pageSize = 2000;

      while (true) {
        const res = await axios.get(`${BASE_URL}/${layer.id}/query`, {
          params: {
            where: "1=1",
            outFields: "*",
            f: "json",
            returnGeometry: false,
            resultOffset: offset,
            resultRecordCount: pageSize,
          },
          headers: {
            "User-Agent": "Mozilla/5.0",
            Referer: "https://gis-web.bellevuewa.gov",
          },
        });

        const features = res.data.features || [];
        if (!features.length) break;

        allRecords.push(
          ...features.map((f) => ({
            ...f.attributes,
            __layerId: layer.id,
            __layerName: layer.name,
          }))
        );

        offset += pageSize;
      }
    }

    if (!allRecords.length) {
      throw new Error("Bellevue returned zero records.");
    }

    const filePath = path.join(
      process.cwd(),
      "downloads",
      "BellevuePermit.json"
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(allRecords, null, 2), "utf-8");

    console.log(`✅ Bellevue saved: ${allRecords.length} records`);
    return allRecords;
  } catch (err) {
    console.error("❌ Bellevue fetch failed:", err.message);
    throw err;
  }
}

// export async function fetchBothellBasic() {
//   const LAYER_URL =
//     "https://services1.arcgis.com/yWC3RwGqrp7oLKhO/arcgis/rest/services/PW_CD_CombinedProjects_view/FeatureServer/33/query";

//   try {
//     let offset = 0;
//     const pageSize = 2000;
//     let allRecords = [];

//     while (true) {
//       const res = await axios.get(LAYER_URL, {
//         params: {
//           where: "1=1",
//           outFields: "*",
//           f: "json",
//           returnGeometry: false,
//           resultOffset: offset,
//           resultRecordCount: pageSize,
//         },
//         headers: {
//           Referer: "https://www.bothellwa.gov/",
//           "User-Agent": "Mozilla/5.0",
//         },
//         timeout: 120000,
//       });

//       const features = res.data.features || [];
//       if (!features.length) break;

//       allRecords.push(...features.map((f) => f.attributes));
//       offset += pageSize;
//     }

//     if (!allRecords.length) {
//       throw new Error("Bothell returned zero records");
//     }

//     const filePath = path.join(
//       process.cwd(),
//       "downloads",
//       "BothellPermit.json"
//     );
//     fs.mkdirSync(path.dirname(filePath), { recursive: true });
//     fs.writeFileSync(filePath, JSON.stringify(allRecords, null, 2), "utf-8");

//     console.log(`✅ Bothell cached: ${allRecords.length} records`);
//     return allRecords;
//   } catch (err) {
//     console.error("❌ Bothell fetch failed:", err.message);
//     throw err;
//   }
// }

export async function fetchBothellBasic(city, maxRetries = 3) {
  const ARC_URL =
    "https://services1.arcgis.com/yWC3RwGqrp7oLKhO/arcgis/rest/services/PW_CD_CombinedProjects_view/FeatureServer/33/query";
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await axios.get(ARC_URL, {
        params: {
          where: "1=1",
          outFields: "*",
          f: "json",
          returnGeometry: true,
        },
      });

      if (city.toLowerCase() === "bothell") {
        const features = response.data?.features || [];

        return features.map((f) => ({
          // IMPORTANT: Your code expects the flat object, not nested attributes
          CaseNumber: f.attributes?.CaseNumber || null,
          Status: f.attributes?.Status || null,
          ProjectName: f.attributes?.ProjectName || null,
          CITY: "Bothell",
        }));
      }
      return response.data.features;
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) throw err;
    }
  }
}
