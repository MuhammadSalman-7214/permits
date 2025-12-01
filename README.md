# Permit Scraper (ArcGIS + MyBuildingPermit)

## What this project does
- Fetches permit features (points) from an ArcGIS FeatureServer endpoint (the map behind the cobgis map).
- For each permit, builds the MyBuildingPermit details URL and scrapes additional fields with Puppeteer.
- Outputs a combined Excel file (`permits.xlsx`) and `permits.csv`.

## Prerequisites
- Node.js 18+
- npm
- Enough disk and memory (Puppeteer downloads Chromium ~100MB+)

## Setup
1. Copy `.env.example` to `.env` and fill values (FEATURE_SERVER_URL is required).
2. `npm install`
3. Run `node index.js` or `npm start`

## Notes
- You must discover the FeatureServer query URL for the permit layer (open browser DevTools > Network when loading the map). Set that URL in `.env` as FEATURE_SERVER_URL.
- The script uses pagination (ArcGIS `resultOffset` / `resultRecordCount`) if needed.
- Puppeteer is used to scrape the detail page. The selector logic might need adjustments per city.

## Files
- `index.js` - orchestrates fetching features, scraping details, and exporting.
- `lib/fetchArcGIS.js` - queries FeatureServer for features.
- `lib/scrapePermit.js` - scrapes MyBuildingPermit detail pages using Puppeteer.
- `lib/exportExcel.js` - writes XLSX/CSV using `xlsx`.

## Example .env values
```
FEATURE_SERVER_URL=https://services.arcgis.com/.../FeatureServer/0/query
CITY_CODE=BELLEVUE
CONCURRENT_BROWSER_TABS=3
OUTPUT_FILE=permits.xlsx
```

## Run (dry-run):
`node index.js --limit=5 --dry-run`

## License
Use responsibly and respect target sites' robots.txt and terms of service.
