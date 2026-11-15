# CertiFlow · Certificate Studio

A light-mode certificate editor and bulk PDF generator built with React + Vite.

## Features

- Upload a PNG, JPG or WEBP certificate background.
- Add multiple text layers, drag them directly on the preview, and edit their content, position, font family, size, colour, weight, italic style and alignment.
- Use `{{name}}` and `{{email}}` placeholders in any text layer.
- Import participant data from `.xlsx`, `.xls` or `.csv` files and map the name and email columns.
- Generate one PDF per participant and download all PDFs in a ZIP. Files are named `Participant Name.pdf`.
- Optionally upload each generated PDF to a Google Drive folder.
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

## Google Drive setup

Google Drive upload is optional. ZIP download works without Google configuration.

1. Open [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials) and select or create a project.
2. Enable the **Google Drive API** for that project.
3. Configure the OAuth consent screen. Add your Google account as a test user while the app is in testing mode.
4. Create an OAuth Client ID with application type **Web application**.
5. Add the app's exact origin to **Authorised JavaScript origins**. For local development, use `http://localhost:5173`. For deployment, add your deployed HTTPS origin.
6. In CertiFlow, open **Google Drive**, paste the OAuth Client ID and the destination folder URL, then choose **Generate & upload**.
7. Sign in and grant the `drive.file` permission when Google asks.

The app uploads PDFs directly from the browser to the selected folder using Google's Drive API. No Google client secret is needed or should be placed in frontend code. The OAuth Client ID is saved in this browser's local storage. Access tokens remain in memory for the current page session.

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
- For best output, use PNG or JPG templates. WEBP templates are converted to PNG in the browser before PDF export.
- Position values are percentages of the original template dimensions, so placement remains consistent across preview and PDF export.
- All processing happens in the browser. Participant spreadsheets and generated PDFs are not sent to a CertiFlow server. When Drive upload is selected, PDFs are sent directly to Google Drive using the signed-in user's access token.

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
