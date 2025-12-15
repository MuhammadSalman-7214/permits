export async function scrapePermit(page, url) {
  const TRUNCATE_LIMIT = 30000;
  const safeTrim = (s) => {
    if (s === null || s === undefined) return "";
    s = String(s).trim();
    if (s.length > TRUNCATE_LIMIT)
      return s.substring(0, TRUNCATE_LIMIT) + " ...[TRUNCATED]";
    return s;
  };

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 70000 });

    await page.waitForTimeout(300);
    await page
      .waitForNetworkIdle({ idleTime: 800, timeout: 10000 })
      .catch(() => {});
    const panelHandle = await page.evaluateHandle(() => {
      const panels = Array.from(
        document.querySelectorAll("div.panel, section.panel")
      );
      for (const p of panels) {
        const h = p.querySelector(
          ".panel-heading, .panel-title, .panel-header, h2, h3, .panel-heading .panel-title"
        );
        if (!h) continue;
        const t = (h.innerText || "").trim();
        if (/Information\s+for\s+Permit/i.test(t)) return p;
      }
      return document.querySelector(
        "div.panel.panel-primary, section.panel-primary"
      );
    });

    const panelExists = await page.evaluate((p) => !!p, panelHandle);
    const extractDescription = async () =>
      page.evaluate((TRUNCATE_LIMIT) => {
        const candidates = [
          ".panel-body p",
          ".panel-body .description",
          "#collapseDescription",
          ".permit-description",
          ".main-description",
          ".panel-body",
        ];
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          if (el && (el.innerText || "").trim().length) {
            const txt = el.innerText.trim();
            return txt.length > TRUNCATE_LIMIT
              ? txt.substring(0, TRUNCATE_LIMIT) + " ...[TRUNCATED]"
              : txt;
          }
        }
        const p = document.querySelector("p");
        return p && p.innerText.trim()
          ? p.innerText.trim().length > TRUNCATE_LIMIT
            ? p.innerText.trim().substring(0, TRUNCATE_LIMIT) +
              " ...[TRUNCATED]"
            : p.innerText.trim()
          : "";
      }, TRUNCATE_LIMIT);
    const extractTableBySelectors = async (selectors) =>
      page.evaluate(
        (sels, TRUNCATE_LIMIT) => {
          const safe = (s) => {
            if (s === null || s === undefined) return "";
            const t = String(s).trim();
            return t.length > TRUNCATE_LIMIT
              ? t.substring(0, TRUNCATE_LIMIT) + " ...[TRUNCATED]"
              : t;
          };

          for (const sel of sels) {
            const el = document.querySelector(sel);
            if (!el) continue;

            if (el.tagName && el.tagName.toLowerCase() === "table") {
              const rows = Array.from(el.querySelectorAll("tbody tr"));
              if (rows.length === 0) continue;
              return rows.map((tr) =>
                Array.from(tr.querySelectorAll("th,td")).map((cell) =>
                  safe(cell.innerText)
                )
              );
            }
            const table = el.querySelector("table");
            if (table) {
              const rows = Array.from(table.querySelectorAll("tbody tr"));
              if (rows.length)
                return rows.map((tr) =>
                  Array.from(tr.querySelectorAll("td,th")).map((c) =>
                    safe(c.innerText)
                  )
                );
            }
            if (
              (el.matches && el.matches(".k-grid-content")) ||
              el.classList.contains("k-grid-content")
            ) {
              const rows = Array.from(el.querySelectorAll("tr"));
              if (rows.length)
                return rows.map((tr) =>
                  Array.from(tr.querySelectorAll("td")).map((td) =>
                    safe(td.innerText)
                  )
                );
            }

            const items = el.querySelectorAll(".k-item");
            if (items.length)
              return Array.from(items).map((it) => [safe(it.innerText)]);

            const genericRows = el.querySelectorAll("tr");
            if (genericRows.length)
              return Array.from(genericRows).map((tr) =>
                Array.from(tr.querySelectorAll("td,th")).map((c) =>
                  safe(c.innerText)
                )
              );
            const childDivs = el.querySelectorAll(":scope > div");
            if (childDivs.length)
              return Array.from(childDivs).map((d) => [safe(d.innerText)]);
          }
          return [];
        },
        selectors,
        TRUNCATE_LIMIT
      );

    // Click tabs to ensure content is loaded
    const tabClickSelectors = [
      [
        "#tabPeople",
        [
          "#permitPeopleGrid .k-grid-content table",
          "#permitPeopleGrid .k-grid-content",
          "#permitPeopleGrid table",
          "#tabPeople",
        ],
      ],
      [
        "#tabFees",
        [
          "#permitFeesGrid .k-grid-content table",
          "#permitFeesGrid .k-grid-content",
          "#permitFeesGrid table",
          "#tabFees",
        ],
      ],
      [
        "#tabReviews",
        [
          "#permitReviewsActivitiesGrid .k-grid-content table",
          "#permitReviewsActivitiesGrid .k-grid-content",
          "#permitReviewsActivitiesGrid table",
          "#tabReviews",
        ],
      ],
      [
        "#tabInspections",
        [
          "#PermitInspectionsGrid .k-grid-content table",
          "#PermitInspectionsGrid .k-grid-content",
          "#PermitInspectionsGrid table",
          "#tabInspections",
        ],
      ],
      [
        "#tabDocuments",
        [
          "#permitDocumentsGrid .k-grid-content table",
          "#permitDocumentsGrid .k-grid-content",
          "#permitDocumentsGrid table",
          "#tabDocuments",
        ],
      ],
      [
        "#tabConditions",
        [
          "#permitConditionsGrid .k-grid-content table",
          "#permitConditionsGrid .k-grid-content",
          "#permitConditionsGrid table",
          "#tabConditions",
        ],
      ],
      [
        "#tabRelated",
        [
          "#permitsOnSameParcelGrid .k-grid-content table",
          "#permitsOnSameParcelGrid .k-grid-content",
          "#permitsOnSameParcelGrid table",
          "#tabRelated",
        ],
      ],
    ];
    for (const [tabSelector] of tabClickSelectors) {
      try {
        const el = await page.$(tabSelector);
        if (el) {
          await page
            .evaluate((s) => {
              const e = document.querySelector(s);
              if (e && typeof e.click === "function") e.click();
            }, tabSelector)
            .catch(() => {});
          await page.waitForTimeout(350).catch(() => {});
          await page
            .waitForNetworkIdle({ idleTime: 600, timeout: 6000 })
            .catch(() => {});
        }
      } catch (e) {}
    }

    let summaryLeft = {};
    let summaryRight = {};

    if (panelExists) {
      // **UPDATED: Single evaluate call for left/right summary**
      const { summaryLeft: left, summaryRight: right } = await page.evaluate(
        (panel, TRUNCATE_LIMIT) => {
          const safe = (s) => {
            if (!s) return "";
            s = String(s).trim();
            return s.length > TRUNCATE_LIMIT
              ? s.substring(0, TRUNCATE_LIMIT) + " ...[TRUNCATED]"
              : s;
          };
          const out = { summaryLeft: {}, summaryRight: {} };
          if (!panel) return out;

          const [leftDiv, rightDiv] = [
            panel.querySelector(
              ".col-md-6:nth-of-type(1), .col-lg-6:nth-of-type(1), .col-sm-6:nth-of-type(1)"
            ) || panel.querySelector("div.row > div:nth-child(1)"),
            panel.querySelector(
              ".col-md-6:nth-of-type(2), .col-lg-6:nth-of-type(2), .col-sm-6:nth-of-type(2)"
            ) || panel.querySelector("div.row > div:nth-child(2)"),
          ];

          const extract = (root) => {
            const o = {};
            if (!root) return o;
            const rows = root.querySelectorAll("tr");
            for (const tr of rows) {
              const th = tr.querySelector("th");
              const td = tr.querySelector("td");
              if (!td) continue;
              let key = th
                ? (th.innerText || "").trim().replace(/\s*:\s*$/, "")
                : "";
              const val = safe(td.innerText || "");
              if (key) o[key] = val;
              else o[`col_${Object.keys(o).length + 1}`] = val;
            }
            return o;
          };

          out.summaryLeft = extract(leftDiv);
          out.summaryRight = extract(rightDiv);
          return out;
        },
        panelHandle,
        TRUNCATE_LIMIT
      );

      summaryLeft = left;
      summaryRight = right;

      // Release panel handle
      await panelHandle.dispose().catch(() => {});
    } else {
      summaryLeft = await page.evaluate(() => {
        const out = {};
        const left = document.querySelector("div.col-md-6, div.col-lg-6");
        if (!left) return out;
        const rows = left.querySelectorAll("tr");
        for (const tr of rows) {
          const th = tr.querySelector("th");
          const td = tr.querySelector("td");
          if (!td || !th) continue;
          out[(th.innerText || "").trim().replace(/\s*:\s*$/, "")] = (
            td.innerText || ""
          ).trim();
        }
        return out;
      });
      summaryRight = {};
    }

    const description = await extractDescription();
    const people = await extractTableBySelectors([
      "#permitPeopleGrid .k-grid-content table",
      "#permitPeopleGrid .k-grid-content",
      "#permitPeopleGrid table",
      "#tabPeople",
    ]);
    const fees = await extractTableBySelectors([
      "#permitFeesGrid .k-grid-content table",
      "#permitFeesGrid .k-grid-content",
      "#permitFeesGrid table",
      "#tabFees",
    ]);
    const reviews = await extractTableBySelectors([
      "#permitReviewsActivitiesGrid .k-grid-content table",
      "#permitReviewsActivitiesGrid .k-grid-content",
      "#permitReviewsActivitiesGrid table",
      "#tabReviews",
    ]);
    const inspections = await extractTableBySelectors([
      "#PermitInspectionsGrid .k-grid-content table",
      "#PermitInspectionsGrid .k-grid-content",
      "#PermitInspectionsGrid table",
      "#tabInspections",
    ]);
    const documents = await extractTableBySelectors([
      "#permitDocumentsGrid .k-grid-content table",
      "#permitDocumentsGrid .k-grid-content",
      "#permitDocumentsGrid table",
      "#tabDocuments",
    ]);
    const conditions = await extractTableBySelectors([
      "#permitConditionsGrid .k-grid-content table",
      "#permitConditionsGrid .k-grid-content",
      "#permitConditionsGrid table",
      "#tabConditions",
    ]);
    const relatedPermits = await extractTableBySelectors([
      "#permitsOnSameParcelGrid .k-grid-content table",
      "#permitsOnSameParcelGrid .k-grid-content",
      "#permitsOnSameParcelGrid table",
      "#tabRelated",
    ]);

    for (const k of Object.keys(summaryLeft))
      summaryLeft[k] = safeTrim(summaryLeft[k]);
    for (const k of Object.keys(summaryRight))
      summaryRight[k] = safeTrim(summaryRight[k]);
    return {
      summaryLeft,
      summaryRight,
      description: safeTrim(description),
      people: people || [],
      fees: fees || [],
      reviews: reviews || [],
      inspections: inspections || [],
      documents: documents || [],
      conditions: conditions || [],
      relatedPermits: relatedPermits || [],
    };
  } catch (err) {
    console.error("❌ Scrape Error:", err && err.message ? err.message : err);
    return { error: err && err.message ? err.message : String(err) };
  }
}
