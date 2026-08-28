# Tidy

Paste anything messy, a messy table or a URL containing the table you want to export and get back a perfectly clean, instantly usable table in whatever format you need (Markdown, CSV, TSV, JSON),
plus one-click APA/MLA citations for anything you pull from the web.

No install and no signup needed. Also it uses no AI as it its not an AI app and no AI features. Also the data never leaves your browser so its lowkey safe af.
<code> https://tidy-three.vercel.app/ </code> <strong> live demo link </strong>
## Why?
Moving small amounts of structured data between tools that disagree on formatting is shitty. Like one thing asks for csv, another asks for tsv and another asks for json. like bruh why not agree on one thing?
Also, 
- Tables copied out of PDFs, Wikipedia, or spreadsheets arrive misaligned and break on quoted commas.
- Getting a quick CSV/JSON version of a webpage table means retyping rows.
- Citations require a separate generator site with signup friction. (I lowkey hate them. A 20$ subscription for a fucking citation? Really???)

Tidy makes it possible to "paste messy thing to get clean thing" as one zero-friction destination. (Of course it does since its made by me.)

<img width="1920" height="953" alt="Screenshot_20260828_201107" src="https://github.com/user-attachments/assets/55f3b420-3239-42a9-87c0-deb8b9fc8d5c" />
<img width="1920" height="946" alt="Screenshot_20260828_201131" src="https://github.com/user-attachments/assets/30c9f0c5-9e27-42eb-bf1d-f1a33e13a4d6" />
<img width="1920" height="947" alt="Screenshot_20260828_201143" src="https://github.com/user-attachments/assets/f443d868-390f-42f2-8b8f-e938898f2539" />


## Features

**1. Paste-to-Clean** : paste raw tabular text; the tool detects the delimiter (comma/tab/pipe/whitespace etc), 

parses quoted fields and normalizes ragged rows with honest warnings, and exports to Markdown / CSV / TSV / JSON.

**2. URL-to-Table** : paste a URL; the server fetches the page (avoiding CORS), extracts all `<table>` elements, and lets you pick one to export in any format.

**3. Instant Citation** : paste an article URL and get an APA or MLA citation built from the page's metadata, with a running bibliography stored locally in your browser.
(and its for **free** free you hear no 20$ like the other shitty sites)

## Run it (If you decide to run it locally by cloning the repo)

```bash
npm install
npm start        # http://localhost:3000
```
Requires Node 18+. No environment variables beyond `PORT` (defaults to 3000). (If you don't have it just download it)

## Known limitations (Yeah not everything is perfect not even this)

- **JavaScript-rendered pages**: tables built client-side after load can't be extracted. Basically the sites that load tables with Javascript cannot be extracted,only static `<table>` elements containing sites can be extracted from URL. In such case best to copy the table you want and paste it in the field and do it that way.
- **Multi-line cells**: cells that wrap across lines in the source paste aren't reconstructed.
- **Mixed-delimiter**: pastes where separators vary within a line are handled best-effort with explicit warnings rather than silent guesses (e.g., `"Doe, Jane" 29 8.7` keeps the quoted name intact but may merge trailing single-space-separated numbers).
- **Citations are plain text**: italics (journal/book titles) can't be carried into plain-text output and be applied in your document. Author/date coverage depends on each site's metadata quality; missing fields degrade gracefully ("n.d.", title-first citations).
- **HTML `colspan`/`rowspan`** cells are read as flat text cells.

## License
MIT
