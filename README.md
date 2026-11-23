# CertiFlow · Certificate Studio

A light-mode certificate editor and bulk PDF generator built with React + Vite.

## Features

- Upload a PNG, JPG or WEBP certificate background.
- Add multiple text layers, drag them directly on the preview, and edit their content, position, font family, size, colour, weight, italic style and alignment.
- Start in a mouse-, touch-, and keyboard-rotatable 3D preview. The reverse side shows “Website developed by” and “Mathew Joseph T A”; clicking a text layer switches to 2D editing. The preview is visual only; exported certificates remain flat PDFs.
- Use `{{name}}` and `{{email}}` placeholders in any text layer.
- Import participant data from `.xlsx`, `.xls` or `.csv` files and map the name and email columns.
- Generate one PDF per participant and download all PDFs in a ZIP. Files are named `Participant Name.pdf`.
- Search generated certificates by filename or participant data; preview PDFs, edit an individual certificate's text, download it again, remove one certificate, or clear all browser history.
- Apply common text-colour or size-scale changes to all saved certificates at once; each PDF is regenerated locally.
- Keep generated PDFs and their editable design data in browser-only IndexedDB history; no CertiFlow database is used.
- Add TTF/OTF font files for the current browser session. Custom TTF/OTF fonts are embedded in generated PDFs.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

To create a production build:

```bash
npm run build
npm run preview
```

## Spreadsheet format

The first worksheet is used. The first row must contain column headers. For example:

| Name | Email |
|---|---|
| Alex Johnson | alex@example.com |
| Sam Thomas | sam@example.com |

Choose the column containing participant names in the Participants tab. The email column is optional and can be inserted into text using `{{email}}`.

## Fonts and PDF notes

- The font dropdown includes common system fonts and Google Fonts used by the interface. For consistent output, upload a TTF or OTF font file and select it for the layer.
- Custom font files are embedded in the generated PDFs. Browser-only font selections may fall back to Helvetica in PDF output because the PDF generator cannot read arbitrary fonts installed on the operating system.
- The PDF keeps text as vector content and embeds the template image at its original resolution. To improve a soft or pixelated background, use the original artwork as a lossless PNG or high-quality JPG; avoid screenshots, thumbnails, and images shared through compression-heavy messaging apps. For print, use artwork sized for the final print dimensions at 300 DPI (for example, about 3508 × 2480 px for A4 landscape).
- WEBP templates are converted to PNG in the browser before PDF export. Converting a low-resolution image to PNG does not restore missing detail.
- Position values are percentages of the original template dimensions, so placement remains consistent across preview and PDF export.
- All processing happens in the browser. Participant spreadsheets and generated PDFs are not sent to a CertiFlow server.
- Browser history is stored in IndexedDB on this device. Clearing site data or using a different browser/device removes or hides that history; download or upload certificates you need to keep.

## Project structure

```text
certiflow/
├── index.html
├── package.json
├── README.md
└── src/
    ├── main.jsx
    └── styles.css
```
