# Client vendor size (0.25)

Measured from the shipped `client.js` IIFE and vendor metafile inputs.

## Policy

- Report raw and gzip for each vendor package and for full `client.js`.
- Report the delta versus `CLIENT_BYTE_BASELINE` (567475).
- `react` stays external (`require('react')`). No second React, no `react-dom` Portal.
- Node builtins and `serialport` / `modbus-serial` must not appear in the client bundle.
- A **new UI library** must not exceed **300 KB gzip** in the vendor report. Do not raise `CLIENT_BYTE_LIMIT` to hide an oversize library; oversize needs its own ADR.
- 0.25 `CLIENT_BYTE_LIMIT` is 1572864 because CodeMirror is in the client. That cap is documented here, not a blank check for later libraries.

## How to refresh

```sh
npm run build
node scripts/report-client-vendors.mjs
```

The script prints per-package raw/gzip, `client.js` raw/gzip, baseline/limit deltas, React/ReactDOM presence, and Node/serial hits. Gzip over 300 KB for `echarts`, `gridstack`, or listed CodeMirror packages fails the script.

## Notes

- ECharts is tree-shaken to Line + Bar + Grid + Tooltip + Legend + CanvasRenderer.
- CodeMirror is read-only EditorView + cpp/json.
- GridStack is decorate-only (`makeWidget` / `update` / `removeWidget(el, false)`).
- `react-arborist` was rejected (peer `react-dom` + dnd).
