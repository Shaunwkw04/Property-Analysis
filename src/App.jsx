import { useState, useMemo, useRef, Fragment } from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";

// ─── CSV / TSV Parser ─────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const isTab = lines[0].includes("\t");
  const splitLine = (line) => {
    if (isTab) return line.split("\t").map((v) => v.trim().replace(/^"|"$/g, ""));
    const result = []; let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === "," && !inQ) { result.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    result.push(cur.trim());
    return result;
  };
  const headers = splitLine(lines[0]);
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const vals = splitLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] || ""; });
    return row;
  });
}

function detectUnitCol(h) {
  return h.find((x) => /unit/i.test(x) && /no/i.test(x)) || h.find((x) => /unit/i.test(x)) || h[2] || h[1];
}
function detectPriceCol(h) {
  return h.find((x) => /jualan/i.test(x) && !/spjb/i.test(x)) || h.find((x) => /harga/i.test(x)) || h.find((x) => /price/i.test(x)) || null;
}
function detectStatusCol(h) {
  return h.find((x) => /status/i.test(x)) || null;
}
function detectSpjbCol(h) {
  return h.find((x) => /spjb/i.test(x)) || h.find((x) => /harga/i.test(x)) || null;
}
function detectBumiCol(h) {
  return h.find((x) => /bumi/i.test(x)) || null;
}
function isBumi(val) {
  const v = String(val || "").toLowerCase().trim();
  return v === "ya" || v === "yes" || v === "bumi" || v === "y";
}

function parseUnitCode(code) {
  if (!code) return null;
  const parts = code.split("-");
  if (parts.length >= 3) return { block: parts[0], floor: parts[1], unitNo: parts[parts.length - 1], raw: code };
  if (parts.length === 2) return { block: parts[0], floor: null, unitNo: parts[1], raw: code };
  return { block: null, floor: null, unitNo: code, raw: code };
}

function parsePrice(val) {
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? NaN : n;
}
function formatPrice(val) {
  const num = parsePrice(val);
  if (isNaN(num) || num === 0) return val || "—";
  if (num >= 1_000_000) {
    const m = num / 1_000_000;
    return `RM${m % 1 === 0 ? m.toFixed(0) : parseFloat(m.toFixed(2))} mill`;
  }
  if (num >= 1_000 && num % 1_000 === 0) return `RM${(num / 1_000).toFixed(0)}k`;
  if (num >= 1_000) return `RM${Math.round(num).toLocaleString("en-MY")}`;
  return `RM${Math.round(num)}`;
}

function isSold(val) {
  // Strip BOM, non-breaking spaces, zero-width chars, and all Unicode whitespace
  const v = String(val || "")
    .replace(/[\u0000-\u001F\u007F-\u00A0\u200B-\u200D\uFEFF]/g, " ")
    .toLowerCase()
    .trim();
  // Only "telah" = sold; "belum" explicitly = NOT sold regardless of what follows
  if (v.includes("belum")) return false;
  if (v.includes("telah")) return true;
  if (v === "sold" || v === "yes" || v === "y") return true;
  return false;
}

function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

const TYPE_COLOURS = [
  "#C9A84C","#4C8EC9","#84C94C","#C94C84","#22c55e",
  "#A84CC9","#C97A4C","#4CA8C9","#C9C94C","#4C4CC9",
];
function typeColor(type, typeList) {
  const idx = typeList.indexOf(type);
  return TYPE_COLOURS[idx % TYPE_COLOURS.length] || "#888";
}

// ─── Small UI components ──────────────────────────────────────────────────────
function Badge({ color, label }) {
  return (
    <span style={{ background: color+"22", color, border:`1px solid ${color}55`, borderRadius:4,
      padding:"2px 7px", fontSize:11, fontWeight:700, letterSpacing:0.4, fontFamily:"monospace" }}>
      {label}
    </span>
  );
}
function BackBtn({ onClick, label }) {
  return (
    <button onClick={onClick} style={{ background:"transparent", border:"1px solid #2a2a40",
      color:"#888", borderRadius:8, padding:"8px 18px", fontSize:13, cursor:"pointer",
      marginBottom:20, display:"inline-flex", alignItems:"center", gap:6 }}>
      {label}
    </button>
  );
}
function SectionHead({ children }) {
  return <div style={{ fontSize:11, fontWeight:700, color:"#C9A84C", letterSpacing:1,
    textTransform:"uppercase", marginBottom:6 }}>{children}</div>;
}

// ─── Sales Status Card ────────────────────────────────────────────────────────
function SalesCard({ label, sold, total, color }) {
  const pct = total > 0 ? ((sold / total) * 100).toFixed(1) : "0.0";
  const unsold = total - sold;
  return (
    <div style={{ background:"#0e0e1c", border:`1px solid ${color}33`, borderRadius:12,
      padding:"14px 18px", minWidth:140, flex:"0 0 auto" }}>
      <div style={{ fontSize:11, color:"#555", letterSpacing:0.5, textTransform:"uppercase", marginBottom:4 }}>
        {label}
      </div>
      <div style={{ fontSize:22, fontWeight:800, color, lineHeight:1 }}>{pct}%</div>
      <div style={{ fontSize:11, color:"#888", marginTop:3 }}>
        <span style={{ color:"#84C94C", fontWeight:700 }}>{sold}</span> sold ·{" "}
        <span style={{ color:"#ff6b6b", fontWeight:700 }}>{unsold}</span> remaining · {total} total
      </div>
      <div style={{ height:5, background:"#1e1e2e", borderRadius:3, marginTop:8, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, background: color, borderRadius:3,
          transition:"width 0.5s" }} />
      </div>
    </div>
  );
}

// ─── Add Block Modal ──────────────────────────────────────────────────────────
function AddBlockPanel({ onAdd, onClose, existingHeaders }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const fileRef = useRef();

  const handleAdd = () => {
    setErr("");
    if (!text.trim()) { setErr("Please paste data first."); return; }
    const rows = parseCSV(text);
    if (!rows.length) { setErr("Could not parse. Check headers on row 1."); return; }
    onAdd({ name: name || `Block ${Date.now()}`, rows, text });
  };
  const handleFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setText(ev.target.result);
    reader.readAsText(file);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:200,
      display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#13131f", border:"1px solid #2a2a40", borderRadius:16,
        padding:28, width:520, maxWidth:"90vw" }}>
        <div style={{ fontSize:17, fontWeight:700, color:"#fff", marginBottom:16 }}>
          ➕ Add Another Block / Dataset
        </div>
        <input
          style={{ ...IS.input, marginBottom:12 }}
          placeholder="Dataset label (e.g. Block B, Tower 2)..."
          value={name} onChange={(e) => setName(e.target.value)}
        />
        <label>
          <input type="file" ref={fileRef} accept=".csv,.tsv,.txt" onChange={handleFile} style={{ display:"none" }} />
          <span style={IS.fileBtn} onClick={() => fileRef.current.click()}>📂 Upload File</span>
        </label>
        <div style={{ fontSize:11, color:"#444", margin:"8px 0 4px" }}>or paste:</div>
        <textarea
          style={{ ...IS.textarea, height:160 }}
          placeholder="Paste tab-separated or CSV data with headers..."
          value={text} onChange={(e) => setText(e.target.value)}
        />
        {err && <div style={{ color:"#ff6b6b", fontSize:12, marginTop:6 }}>⚠ {err}</div>}
        <div style={{ display:"flex", gap:10, marginTop:14 }}>
          <button style={IS.btn} onClick={handleAdd}>Add Dataset →</button>
          <button style={IS.ghostBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Sales Chart Component ────────────────────────────────────────────────────
function floorSortValue(f) {
  const num = parseInt(f);
  if (isNaN(num)) return f === "M" ? 0.5 : f === "G" ? 0 : 0;
  return num + (f.replace(/^\d+/, "") ? 0.5 : 0);
}

// Classify missing cells per unit column:
// - Gaps SURROUNDED by present floors on both sides → "breakTank" (physical obstruction)
// - Gaps at the TOP or BOTTOM edge of the column   → "na" (unit doesn't exist on those floors)
function classifyMissingCells(floors, lookup, unitNo) {
  const present = floors.map((f) => !!lookup[`${f}|${unitNo}`]);
  const firstPresent = present.indexOf(true);
  const lastPresent  = present.lastIndexOf(true);

  const map = {};
  // If unit never appears in this block, everything is N/A
  if (firstPresent === -1) {
    floors.forEach((f) => { map[f] = "na"; });
    return map;
  }

  floors.forEach((f, idx) => {
    if (present[idx]) return; // present, skip
    if (idx < firstPresent || idx > lastPresent) {
      map[f] = "na";        // outside the range where unit exists
    } else {
      map[f] = "breakTank"; // interior gap surrounded by present floors
    }
  });
  return map;
}

// PSF anomaly: for a column of PSF values (high floor → low), flag if ±30% from rolling median of neighbours
// Skip bumi rows
// Two-pass PSF anomaly detection per unit column (already called per-block, per-unit):
// Pass 1: naive detection to identify rough anomalies
// Pass 2: re-evaluate each value using only CLEAN (non-anomaly) neighbours from pass 1
// This stops a bad value from pulling adjacent values into false-positive territory.
// Bumi units are always skipped — they are naturally cheaper.
function computePsfAnomalies(floorPsfPairs) {
  const THRESHOLD = 0.30;
  // Only work with non-bumi sold entries
  const entries = floorPsfPairs.filter((x) => !isNaN(x.psf) && !x.bumi);
  if (entries.length < 3) return new Set();

  const getNeighbourAvg = (idx, skipSet) => {
    const neighbours = [];
    for (let d = 1; neighbours.length < 3 && d < entries.length; d++) {
      const lo = idx - d, hi = idx + d;
      if (lo >= 0 && !skipSet.has(lo)) neighbours.push(entries[lo].psf);
      if (hi < entries.length && !skipSet.has(hi) && neighbours.length < 3)
        neighbours.push(entries[hi].psf);
    }
    return neighbours.length >= 2
      ? neighbours.reduce((s, v) => s + v, 0) / neighbours.length
      : NaN;
  };

  // Pass 1 — naive (no skipping)
  const pass1 = new Set();
  entries.forEach((e, idx) => {
    const avg = getNeighbourAvg(idx, new Set());
    if (!isNaN(avg) && avg > 0 && Math.abs(e.psf - avg) / avg >= THRESHOLD)
      pass1.add(idx);
  });

  // Pass 2 — skip pass-1 anomalies when collecting neighbours
  const pass2 = new Set();
  entries.forEach((e, idx) => {
    const avg = getNeighbourAvg(idx, pass1);
    if (!isNaN(avg) && avg > 0 && Math.abs(e.psf - avg) / avg >= THRESHOLD)
      pass2.add(idx);
  });

  // Return the floor identifiers of confirmed anomalies
  const result = new Set();
  pass2.forEach((idx) => result.add(entries[idx].floor));
  return result;
}

function SalesChart({ enrichedRows, spjbCol, priceCol, sqftMap, bedroomMap, allTypes, typeColor }) {
  const priceMetric = spjbCol || priceCol;
  const [showOnlyBreakTanks, setShowOnlyBreakTanks] = useState(false);

  const blockEntries = useMemo(() => {
    const map = {};
    enrichedRows.forEach((r) => {
      const b = r._parsed?.block || r._datasetName || "?";
      if (!map[b]) map[b] = [];
      map[b].push(r);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [enrichedRows]);

  if (!blockEntries.length) return null;

  const cs = {
    table: { borderCollapse:"collapse", fontSize:12, tableLayout:"fixed" },
    labelCell: { padding:"7px 14px", border:"1px solid #1a1a2e", fontSize:11,
      fontWeight:700, color:"#555", background:"#0e0e1c", whiteSpace:"nowrap",
      textAlign:"left", width:68 },
    typeCell: (col) => ({ padding:"8px 10px", border:"1px solid #1a1a2e", textAlign:"center",
      fontWeight:800, fontSize:13, letterSpacing:0.5,
      background: col + "18", color: col, whiteSpace:"nowrap" }),
    metaCell: { padding:"6px 10px", border:"1px solid #1a1a2e", textAlign:"center",
      color:"#888", background:"#0e0e1c", whiteSpace:"nowrap" },
    unitCell: (bumi) => ({ padding:"6px 10px", width:88,
      border: bumi ? "1px solid #22c55e55" : "1px solid #1a1a2e",
      textAlign:"center", background: bumi ? "#22c55e14" : "#13131f",
      color: bumi ? "#86efac" : "#ccc", fontFamily:"monospace", fontSize:11,
      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }),
    priceCell: (bumi, anomaly) => ({ padding:"6px 10px", width:88,
      border: anomaly ? "1px solid #ff444488" : bumi ? "1px solid #22c55e55" : "1px solid #1a1a2e",
      textAlign:"center",
      background: anomaly ? "#1a0808" : bumi ? "#22c55e0a" : "#0f0f1d",
      color: anomaly ? "#ff4444" : bumi ? "#86efac" : "#C9A84C",
      fontWeight:700, fontFamily:"monospace", fontSize:11, whiteSpace:"nowrap" }),
    psfCell: (bumi, anomaly) => ({ padding:"5px 10px", width:88,
      border: anomaly ? "1px solid #ff444488" : bumi ? "1px solid #22c55e55" : "1px solid #1a1a2e",
      textAlign:"center",
      background: anomaly ? "#1a0808" : bumi ? "#22c55e0a" : "#0c0c18",
      color: anomaly ? "#ff4444" : bumi ? "#86efacaa" : "#666",
      fontFamily:"monospace", fontSize:11, whiteSpace:"nowrap" }),
    breakCell: { padding:"6px 10px", width:88, border:"1px solid #2a2a3a", textAlign:"center",
      background:"#1a1a2e", color:"#3a3a5a", fontStyle:"italic", fontSize:10, whiteSpace:"nowrap" },
    naCell: { padding:"6px 10px", width:88, border:"1px solid #0e0e18", textAlign:"center",
      background:"#080810", color:"#1a1a28", fontSize:10, whiteSpace:"nowrap" },
    dashCell: (bg) => ({ padding:"5px 10px", width:88, border:"1px solid #1a1a2e",
      textAlign:"center", background: bg || "#0f0f1d", color:"#2a2a4a", whiteSpace:"nowrap" }),
    gapRow: { height:3, background:"#0c0c18", padding:0 },
  };

  return (
    <div style={{ marginTop:32 }}>
      <div style={{ fontSize:16, fontWeight:700, color:"#fff", marginBottom:4, letterSpacing:0.5 }}>
        🏢 Sales Price Chart
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16, flexWrap:"wrap" }}>
        <div style={{ fontSize:12, color:"#555", display:"flex", gap:16, flexWrap:"wrap" }}>
          <span><span style={{ display:"inline-block", width:10, height:10, background:"#22c55e22", border:"1px solid #22c55e55", borderRadius:2, marginRight:5 }}/>Bumi (green)</span>
          <span><span style={{ display:"inline-block", width:10, height:10, background:"#1a0808", border:"1px solid #ff4444", borderRadius:2, marginRight:5 }}/>⚠ PSF anomaly (±30% from neighbours)</span>
          <span style={{ fontStyle:"italic", color:"#3a3a5a" }}>Break Tank = physical obstruction (1–2 missing floors)</span>
          <span style={{ color:"#1e1e2e" }}>■</span><span style={{ color:"#444" }}>N/A = unit absent across 3+ consecutive floors</span>
        </div>
        <button
          onClick={() => setShowOnlyBreakTanks((v) => !v)}
          style={{ marginLeft:"auto", background: showOnlyBreakTanks ? "#2a2a1a" : "#1a1a2e",
            border: `1px solid ${showOnlyBreakTanks ? "#C9A84C" : "#2a2a3a"}`,
            borderRadius:6, padding:"5px 14px", fontSize:11,
            color: showOnlyBreakTanks ? "#C9A84C" : "#555", cursor:"pointer", whiteSpace:"nowrap" }}>
          {showOnlyBreakTanks ? "✕ Clear Break Tank filter" : "🔍 Show Break Tanks only"}
        </button>
      </div>

      {blockEntries.map(([blockName, rows]) => {
        const unitNos = [...new Set(rows.map((r) => r._parsed?.unitNo).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        const floors = [...new Set(rows.map((r) => r._parsed?.floor).filter(Boolean))]
          .sort((a, b) => floorSortValue(b) - floorSortValue(a));

        const lookup = {};
        rows.forEach((r) => {
          if (r._parsed?.floor && r._parsed?.unitNo)
            lookup[`${r._parsed.floor}|${r._parsed.unitNo}`] = r;
        });

        // Per unit column: classify each missing floor as na/breakTank
        const missingKind = {}; // "unitNo|floor" → "na" | "breakTank"
        unitNos.forEach((u) => {
          const map = classifyMissingCells(floors, lookup, u);
          Object.entries(map).forEach(([f, kind]) => { missingKind[`${u}|${f}`] = kind; });
        });

        // PSF anomaly detection: per-block (already scoped here), per-type, per-unit-column.
        // Each unit column is evaluated independently so Block A pricing never affects Block B,
        // and Type A PSF values never contaminate Type C comparisons.
        const psfAnomalySet = new Set(); // key: "floor|unitNo"
        unitNos.forEach((u) => {
          const colPairs = floors.map((f) => {
            const row = lookup[`${f}|${u}`];
            if (!row || !priceMetric) return { floor: f, psf: NaN, bumi: false };
            const p = parsePrice(row[priceMetric]);
            if (isNaN(p) || p === 0) return { floor: f, psf: NaN, bumi: false };
            const sf = Number(sqftMap[row._assignedType] || 0);
            const psf = sf > 0 ? Math.round(p / sf) : NaN;
            return { floor: f, psf, bumi: !!row._bumi };
          });
          computePsfAnomalies(colPairs).forEach((f) => psfAnomalySet.add(`${f}|${u}`));
        });

        // Type groups for header
        const typeForUnit = {};
        unitNos.forEach((u) => {
          const r = rows.find((r) => r._parsed?.unitNo === u && r._assignedType);
          typeForUnit[u] = r?._assignedType || "—";
        });
        const typeGroups = [];
        unitNos.forEach((u) => {
          const t = typeForUnit[u];
          if (!typeGroups.length || t !== typeGroups[typeGroups.length - 1].type)
            typeGroups.push({ type: t, cols: [u] });
          else typeGroups[typeGroups.length - 1].cols.push(u);
        });

        // Which floors have at least one break tank
        const breakTankFloors = new Set(
          floors.filter((f) =>
            unitNos.some((u) => missingKind[`${u}|${f}`] === "breakTank")
          )
        );

        const floorsToShow = showOnlyBreakTanks
          ? floors.filter((f) => breakTankFloors.has(f))
          : floors;

        if (showOnlyBreakTanks && floorsToShow.length === 0) return (
          <div key={blockName} style={{ marginBottom:40 }}>
            <div style={{ fontSize:14, fontWeight:800, color:"#C9A84C", marginBottom:10,
              letterSpacing:0.5, textTransform:"uppercase" }}>Tower / Block {blockName}</div>
            <div style={{ color:"#555", fontSize:13, padding:"16px", background:"#13131f",
              borderRadius:8, border:"1px solid #1e1e2e" }}>No Break Tanks found in this block.</div>
          </div>
        );

        return (
          <div key={blockName} style={{ marginBottom:40 }}>
            <div style={{ fontSize:14, fontWeight:800, color:"#C9A84C", marginBottom:12,
              letterSpacing:0.5, textTransform:"uppercase" }}>
              Tower / Block {blockName}
              {showOnlyBreakTanks && <span style={{ fontSize:11, color:"#888", fontWeight:400,
                marginLeft:10, textTransform:"none" }}>— {floorsToShow.length} floor{floorsToShow.length !== 1 ? "s" : ""} with break tanks</span>}
            </div>
            <div style={{ overflowX:"auto", borderRadius:10, border:"1px solid #1a1a2e" }}>
              <table style={cs.table}>
                <tbody>

                  {/* Type row */}
                  <tr>
                    <td style={cs.labelCell}>Type</td>
                    {typeGroups.map((g, i) => {
                      const col = g.type !== "—" ? typeColor(g.type, allTypes) : "#555";
                      return <td key={i} colSpan={g.cols.length} style={cs.typeCell(col)}>{g.type}</td>;
                    })}
                  </tr>

                  {/* Layout row */}
                  <tr>
                    <td style={cs.labelCell}>Layout</td>
                    {typeGroups.map((g, i) => (
                      <td key={i} colSpan={g.cols.length} style={cs.metaCell}>{bedroomMap[g.type] || "—"}</td>
                    ))}
                  </tr>

                  {/* Sqft row */}
                  <tr>
                    <td style={cs.labelCell}>Sqft</td>
                    {typeGroups.map((g, i) => (
                      <td key={i} colSpan={g.cols.length} style={cs.metaCell}>
                        {sqftMap[g.type] ? `${Number(sqftMap[g.type]).toLocaleString()} sf` : "—"}
                      </td>
                    ))}
                  </tr>

                  <tr><td colSpan={unitNos.length + 1} style={{ ...cs.gapRow, background:"#1a1a2e", height:4 }} /></tr>

                  {/* Floor rows */}
                  {floorsToShow.map((floor) => {
                    const floorRowData = unitNos.map((u) => lookup[`${floor}|${u}`] || null);
                    const anyExists = floorRowData.some((r) => r !== null);
                    if (!anyExists) return null;

                    const missingCell = (u) => {
                      const kind = missingKind[`${u}|${floor}`];
                      if (kind === "na") return <td key={u} style={cs.naCell}>—</td>;
                      return <td key={u} style={cs.breakCell}>Break Tank</td>;
                    };

                    return (
                      <Fragment key={floor}>
                        {/* Level */}
                        <tr>
                          <td style={{ ...cs.labelCell, color:"#C9A84C" }}>Level</td>
                          {unitNos.map((u, i) => {
                            const row = floorRowData[i];
                            if (!row) return missingCell(u);
                            return (
                              <td key={u} style={cs.unitCell(row._bumi)}>
                                {row._parsed?.raw || "—"}
                                {row._bumi && <span style={{ fontSize:9, marginLeft:4, opacity:0.7 }}>●</span>}
                              </td>
                            );
                          })}
                        </tr>

                        {/* RM */}
                        <tr>
                          <td style={{ ...cs.labelCell, color:"#888" }}>RM</td>
                          {unitNos.map((u, i) => {
                            const row = floorRowData[i];
                            if (!row) return <td key={u} style={missingKind[`${u}|${floor}`] === "na" ? cs.naCell : { ...cs.breakCell, padding:"5px 10px" }} />;
                            const p = priceMetric ? parsePrice(row[priceMetric]) : NaN;
                            if (isNaN(p) || p === 0) return <td key={u} style={cs.dashCell()}> — </td>;
                            const anomaly = psfAnomalySet.has(`${floor}|${u}`);
                            return (
                              <td key={u} style={cs.priceCell(row._bumi, anomaly)}>
                                {p.toLocaleString("en-MY")}
                                {anomaly && !row._bumi && <span style={{ fontSize:9, marginLeft:3 }}>⚠</span>}
                              </td>
                            );
                          })}
                        </tr>

                        {/* PSF */}
                        <tr>
                          <td style={{ ...cs.labelCell, color:"#666" }}>PSF</td>
                          {unitNos.map((u, i) => {
                            const row = floorRowData[i];
                            if (!row) return <td key={u} style={missingKind[`${u}|${floor}`] === "na" ? cs.naCell : { ...cs.breakCell, padding:"5px 10px" }} />;
                            const p = priceMetric ? parsePrice(row[priceMetric]) : NaN;
                            if (isNaN(p) || p === 0) return <td key={u} style={cs.dashCell("#0c0c18")}> — </td>;
                            const sf = Number(sqftMap[row._assignedType] || 0);
                            const psf = sf > 0 ? Math.round(p / sf) : NaN;
                            const anomaly = psfAnomalySet.has(`${floor}|${u}`);
                            return (
                              <td key={u} style={cs.psfCell(row._bumi, anomaly)}>
                                {isNaN(psf) ? "—" : psf}
                                {anomaly && !row._bumi && <span style={{ fontSize:9, marginLeft:3 }}>⚠</span>}
                              </td>
                            );
                          })}
                        </tr>

                        <tr><td colSpan={unitNos.length + 1} style={cs.gapRow} /></tr>
                      </Fragment>
                    );
                  })}

                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Unit Override Search Component ──────────────────────────────────────────
function UnitOverrideSearch({ parsedUnits, typeMap, setTypeMap, allTypes, typeColor }) {
  const [query, setQuery] = useState("");
  const [editingKey, setEditingKey] = useState(null);
  const [editVal, setEditVal] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set();
    return parsedUnits
      .filter((r) => r._parsed?.raw && r._parsed.raw.toLowerCase().includes(q))
      .filter((r) => {
        if (seen.has(r._parsed.raw)) return false;
        seen.add(r._parsed.raw);
        return true;
      })
      .slice(0, 12); // cap results
  }, [query, parsedUnits]);

  const commit = (rawKey) => {
    if (editVal.trim()) setTypeMap((p) => ({ ...p, [rawKey]: editVal.trim() }));
    setEditingKey(null);
    setEditVal("");
  };

  const cs = {
    wrap: { marginBottom: 16 },
    inputRow: { position:"relative", marginBottom:8 },
    inp: { width:"100%", boxSizing:"border-box", background:"#0c0c18",
      border:"1px solid #2a2a40", color:"#ddd", borderRadius:8,
      padding:"9px 32px 9px 14px", fontSize:13, fontFamily:"monospace", outline:"none" },
    clearBtn: { position:"absolute", right:8, top:"50%", transform:"translateY(-50%)",
      background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:14, padding:0 },
    hint: { fontSize:11, color:"#444", marginBottom:8 },
    resultRow: { display:"flex", alignItems:"center", gap:8, padding:"7px 10px",
      background:"#0c0c18", borderRadius:6, border:"1px solid #1a1a2e", marginBottom:4 },
    rawCode: { fontFamily:"monospace", fontSize:12, color:"#C9A84C", minWidth:90 },
    editInp: { flex:1, background:"#13131f", border:"1px solid #C9A84C66",
      color:"#fff", borderRadius:4, padding:"4px 8px", fontSize:12,
      fontFamily:"monospace", outline:"none" },
    saveBtn: { background:"#C9A84C", color:"#0c0c18", border:"none",
      borderRadius:4, padding:"4px 10px", fontSize:11, fontWeight:700, cursor:"pointer" },
    cancelBtn: { background:"none", border:"1px solid #2a2a40", color:"#666",
      borderRadius:4, padding:"4px 10px", fontSize:11, cursor:"pointer" },
    editBtn: { background:"none", border:"1px solid #2a2a40", color:"#888",
      borderRadius:4, padding:"3px 10px", fontSize:11, cursor:"pointer", marginLeft:"auto" },
    clearType: { background:"none", border:"none", color:"#ff6b6b44",
      cursor:"pointer", fontSize:13, padding:"0 2px" },
  };

  return (
    <div style={cs.wrap}>
      <div style={cs.inputRow}>
        <input
          style={cs.inp}
          placeholder="Type full or partial unit code — e.g. B-11-07 or B-11..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setEditingKey(null); }}
        />
        {query && (
          <button style={cs.clearBtn} onClick={() => { setQuery(""); setEditingKey(null); }}>✕</button>
        )}
      </div>

      {query && results.length === 0 && (
        <div style={cs.hint}>No units found matching "{query}"</div>
      )}
      {!query && (
        <div style={cs.hint}>Start typing to search across all units including floor level.</div>
      )}

      {results.map((r) => {
        const raw = r._parsed.raw;
        const existing = typeMap[raw];
        // Also check if covered by a block-unit key
        const shortKey = r._parsed.block ? `${r._parsed.block}-${r._parsed.unitNo}` : r._parsed.unitNo;
        const inherited = !existing && typeMap[shortKey];
        const isEditing = editingKey === raw;
        const col = existing ? typeColor(existing, allTypes) : "#555";

        return (
          <div key={raw} style={{
            ...cs.resultRow,
            borderColor: existing ? col + "55" : "#1a1a2e",
            background: existing ? col + "0c" : "#0c0c18",
          }}>
            <code style={cs.rawCode}>{raw}</code>

            {!isEditing && (
              <>
                {existing
                  ? <><span style={{ fontSize:11, background:col+"22", color:col,
                        border:`1px solid ${col}44`, borderRadius:4, padding:"1px 7px",
                        fontWeight:700, fontFamily:"monospace" }}>{existing}</span>
                      <span style={{ fontSize:10, color:"#555" }}>override</span></>
                  : inherited
                    ? <span style={{ fontSize:11, color:"#555" }}>inherited: <strong style={{ color:"#888" }}>{inherited}</strong></span>
                    : <span style={{ fontSize:11, color:"#333" }}>no type</span>
                }
                <button style={cs.editBtn}
                  onClick={() => { setEditingKey(raw); setEditVal(existing || inherited || ""); }}>
                  {existing ? "Change" : "Assign"}
                </button>
                {existing && (
                  <button style={cs.clearType}
                    title="Clear override"
                    onClick={() => setTypeMap((p) => { const n={...p}; delete n[raw]; return n; })}>
                    ✕
                  </button>
                )}
              </>
            )}

            {isEditing && (
              <>
                <input
                  autoFocus
                  style={cs.editInp}
                  placeholder="e.g. C2"
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commit(raw); if (e.key === "Escape") { setEditingKey(null); setEditVal(""); } }}
                />
                <button style={cs.saveBtn} onClick={() => commit(raw)}>Save</button>
                <button style={cs.cancelBtn} onClick={() => { setEditingKey(null); setEditVal(""); }}>Cancel</button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState("upload");

  // datasets: [{ id, name, rows, headers }]
  const [datasets, setDatasets] = useState([]);
  const [showAddBlock, setShowAddBlock] = useState(false);

  const [unitCol, setUnitCol]     = useState("");
  const [priceCol, setPriceCol]   = useState("");
  const [spjbCol, setSpjbCol]     = useState(""); // SPJB price — used for sorting & anomaly
  const [statusCol, setStatusCol] = useState("");
  const [bumiCol, setBumiCol]     = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState("");

  const [typeMap, setTypeMap]       = useState({});  // "B-01" → "C2"
  const [bedroomMap, setBedroomMap] = useState({});  // "C2" → "3+1R"
  const [sqftMap, setSqftMap]       = useState({});  // "C2" → 1109 (sq ft)

  const [filterType, setFilterType] = useState("ALL");
  const [blockFilter, setBlockFilter] = useState("ALL");
  const [floorFilter, setFloorFilter] = useState("ALL");
  const [unitSearch, setUnitSearch]   = useState("");
  const [unitSearchStep2, setUnitSearchStep2] = useState("");
  const [searchTerm, setSearchTerm]   = useState("");
  const [sortOrder, setSortOrder]     = useState("asc");
  const [showOnlyAnomalies, setShowOnlyAnomalies] = useState(false);

  // ── Saved projects (localStorage) ────────────────────────────────────────────
  const [savedProjects, setSavedProjects] = useState(() => {
    try { return JSON.parse(localStorage.getItem("prc_saved_projects") || "[]"); } catch { return []; }
  });
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveProjectName, setSaveProjectName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [editingDatasetId, setEditingDatasetId] = useState(null);
  const [editDataText, setEditDataText] = useState("");
  const [editDataError, setEditDataError] = useState("");
  const [projectSearch, setProjectSearch] = useState("");

  // ── Derived: merge all datasets ──────────────────────────────────────────────
  const allHeaders = useMemo(() => {
    if (!datasets.length) return [];
    // Union of all headers, keeping first dataset order as base
    const base = datasets[0].headers;
    const extra = datasets.slice(1).flatMap((d) => d.headers.filter((h) => !base.includes(h)));
    return [...base, ...extra];
  }, [datasets]);

  const rawRows = useMemo(() =>
    datasets.flatMap((d) => d.rows.map((r) => ({ ...r, _datasetName: d.name }))),
    [datasets]
  );

  const parsedUnits = useMemo(() =>
    rawRows.map((row) => ({ ...row, _parsed: parseUnitCode(row[unitCol] || "") })),
    [rawRows, unitCol]
  );

  const uniqueUnitKeys = useMemo(() => {
    const seen = new Set();
    parsedUnits.forEach((r) => {
      if (!r._parsed) return;
      seen.add(r._parsed.block ? `${r._parsed.block}-${r._parsed.unitNo}` : r._parsed.unitNo);
    });
    return [...seen].sort();
  }, [parsedUnits]);

  const uniqueUnitNos = useMemo(() => {
    // Last segment of full code: "B-11-07" → "07", "C-G-01" → "01"
    const s = new Set(uniqueUnitKeys.map((k) => k.split("-").pop()));
    return [...s].sort();
  }, [uniqueUnitKeys]);

  const uniqueFloors = useMemo(() => {
    const s = new Set(parsedUnits.map((r) => r._parsed?.floor).filter(Boolean));
    return [...s].sort();
  }, [parsedUnits]);

  const uniqueBlocks = useMemo(() => {
    const s = new Set(parsedUnits.map((r) => r._parsed?.block).filter(Boolean));
    return [...s].sort();
  }, [parsedUnits]);

  const enrichedRows = useMemo(() =>
    parsedUnits.map((row) => {
      const p = row._parsed;
      // Primary key: block-unitNo (e.g. "C-01"). Full raw code overrides take priority.
      const shortKey = p ? (p.block ? `${p.block}-${p.unitNo}` : p.unitNo) : "";
      const fullKey  = p?.raw || "";
      // Full raw code (e.g. "B-11-07") takes priority over block-unit key
      const type = (fullKey && typeMap[fullKey]) || typeMap[shortKey] || "";
      return {
        ...row,
        _assignedType: type,
        _bedroom: type ? (bedroomMap[type] || "") : "",
        _sold: statusCol ? isSold(row[statusCol]) : false,
        _bumi: bumiCol ? isBumi(row[bumiCol]) : false,
      };
    }),
    [parsedUnits, typeMap, bedroomMap, statusCol, bumiCol]
  );

  const allTypes = useMemo(() => {
    const s = new Set(Object.values(typeMap).filter(Boolean));
    return [...s].sort();
  }, [typeMap]);

  // ── Anomaly detection (per type, ±30% from median SPJB price) ──────────────
  const anomalySet = useMemo(() => {
    const metricCol = spjbCol || priceCol;
    if (!metricCol) return new Set();
    const byType = {};
    enrichedRows.forEach((r, i) => {
      if (!r._assignedType) return;
      if (!byType[r._assignedType]) byType[r._assignedType] = [];
      const p = parsePrice(r[metricCol]);
      if (!isNaN(p)) byType[r._assignedType].push({ i, p });
    });
    const flagged = new Set();
    Object.values(byType).forEach((entries) => {
      const prices = entries.map((e) => e.p);
      const med = median(prices);
      entries.forEach(({ i, p }) => {
        if (Math.abs(p - med) / med >= 0.3) flagged.add(i);
      });
    });
    return flagged;
  }, [enrichedRows, spjbCol, priceCol]);

  // ── Sales stats ──────────────────────────────────────────────────────────────
  const salesByBlock = useMemo(() => {
    if (!statusCol) return {};
    const stats = {};
    enrichedRows.forEach((r) => {
      const blk = r._parsed?.block || r._datasetName || "Unknown";
      if (!stats[blk]) stats[blk] = { sold: 0, total: 0 };
      stats[blk].total++;
      if (r._sold) stats[blk].sold++;
    });
    return stats;
  }, [enrichedRows, statusCol]);

  const salesOverall = useMemo(() => {
    const total = enrichedRows.length;
    const sold = enrichedRows.filter((r) => r._sold).length;
    return { total, sold };
  }, [enrichedRows]);

  // ── Type stats (total + sold) ─────────────────────────────────────────────────
  const typeStats = useMemo(() => {
    const stats = {};
    enrichedRows.forEach((r) => {
      const t = r._assignedType || "Unassigned";
      if (!stats[t]) stats[t] = { total: 0, sold: 0 };
      stats[t].total++;
      if (r._sold) stats[t].sold++;
    });
    return stats;
  }, [enrichedRows]);

  // ── Bedroom distribution ──────────────────────────────────────────────────────
  const bedroomDist = useMemo(() => {
    const total = enrichedRows.length;
    if (!total) return [];
    const counts = {};
    enrichedRows.forEach((r) => {
      const raw = (r._bedroom || "").replace(/R$/i, "").trim();
      if (!raw) return;
      counts[raw] = (counts[raw] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count, pct: ((count / total) * 100).toFixed(1) }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [enrichedRows]);

  // ── Bumi stats — only counts SOLD units (bumi quota activates on sale) ────────
  const bumiStats = useMemo(() => {
    if (!bumiCol) return null;
    const allBumiSlots  = enrichedRows.filter((r) => r._bumi).length;          // total designated bumi units
    const soldRows      = enrichedRows.filter((r) => r._sold);
    const bumiSold      = soldRows.filter((r) => r._bumi).length;              // sold AND bumi
    const nonBumiSold   = soldRows.filter((r) => !r._bumi).length;            // sold AND non-bumi
    const totalSold     = soldRows.length;
    const pctOfSold     = totalSold > 0 ? ((bumiSold / totalSold) * 100).toFixed(1) : "0.0";
    const bumiSoldOfSlots = allBumiSlots > 0 ? ((bumiSold / allBumiSlots) * 100).toFixed(1) : "0.0";
    return {
      allBumiSlots, bumiSold, nonBumiSold, totalSold,
      pctOfSold,          // bumi % of all sold units
      bumiSoldOfSlots,    // how much of bumi quota has been filled
      grandTotal: enrichedRows.length,
    };
  }, [enrichedRows, bumiCol]);

  // ── Filtered + sorted rows (sort by SPJB price) ───────────────────────────────
  const filtered = useMemo(() => {
    const sortMetric = spjbCol || priceCol;
    let rows = enrichedRows.map((r, _origIdx) => ({ ...r, _origIdx })).filter((r) => {
      const matchType =
        filterType === "ALL" ||
        (filterType === "Unassigned" ? !r._assignedType : r._assignedType === filterType);
      const matchBlock = blockFilter === "ALL" ||
        r._parsed?.block === blockFilter || r._datasetName === blockFilter;
      const matchFloor = floorFilter === "ALL" || r._parsed?.floor === floorFilter;
      const matchUnitSearch = !unitSearch.trim() || (() => {
        const q = unitSearch.trim().toLowerCase();
        const unitNo = (r._parsed?.unitNo || "").toLowerCase();
        const raw = (r._parsed?.raw || "").toLowerCase();
        if (q.includes("-") && q.split("-").length === 2) {
          const [lo, hi] = q.split("-");
          return unitNo >= lo && unitNo <= hi;
        }
        if (q.includes(",")) {
          return q.split(",").map((x) => x.trim()).some((x) => unitNo === x || raw.includes(x));
        }
        return raw.includes(q) || unitNo.includes(q);
      })();
      const matchSearch = !searchTerm ||
        Object.entries(r).filter(([k]) => !k.startsWith("_")).some(([, v]) =>
          String(v).toLowerCase().includes(searchTerm.toLowerCase()));
      return matchType && matchBlock && matchFloor && matchUnitSearch && matchSearch;
    });
    if (sortMetric) {
      rows = [...rows].sort((a, b) => {
        const pa = parsePrice(a[sortMetric]), pb = parsePrice(b[sortMetric]);
        if (isNaN(pa) && isNaN(pb)) return 0;
        if (isNaN(pa)) return 1; if (isNaN(pb)) return -1;
        return sortOrder === "asc" ? pa - pb : pb - pa;
      });
    }
    return rows;
  }, [enrichedRows, filterType, blockFilter, floorFilter, unitSearch, searchTerm, spjbCol, priceCol, sortOrder]);

  // anomalyCount is based on all filtered rows (before anomaly-only toggle)
  const anomalyCount = useMemo(() => filtered.filter((r) => anomalySet.has(r._origIdx)).length, [filtered, anomalySet]);

  // filteredFinal applies the anomaly-only toggle on top
  const filteredFinal = useMemo(() => {
    if (!showOnlyAnomalies) return filtered;
    return filtered.filter((r) => anomalySet.has(r._origIdx));
  }, [filtered, showOnlyAnomalies, anomalySet]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const processFirstDataset = (text, name = "Block A") => {
    setPasteError("");
    if (!text.trim()) { setPasteError("Please paste data first."); return false; }
    const rows = parseCSV(text);
    if (!rows.length) { setPasteError("Could not parse — check that headers are on row 1."); return false; }
    const headers = Object.keys(rows[0]);
    setDatasets([{ id: Date.now(), name, headers, rows }]);
    setUnitCol(detectUnitCol(headers));
    setPriceCol(detectPriceCol(headers) || "");
    setSpjbCol(detectSpjbCol(headers) || "");
    setStatusCol(detectStatusCol(headers) || "");
    setBumiCol(detectBumiCol(headers) || "");
    setTypeMap({}); setBedroomMap({});
    setFilterType("ALL"); setFloorFilter("ALL"); setUnitSearch("");
    setSearchTerm(""); setSortOrder("asc");
    setStep("map");
    return true;
  };

  const addDataset = ({ name, rows }) => {
    const headers = Object.keys(rows[0]);
    setDatasets((prev) => [...prev, { id: Date.now(), name, headers, rows }]);
    setShowAddBlock(false);
  };

  const removeDataset = (id) => setDatasets((prev) => prev.filter((d) => d.id !== id));

  const handleReset = () => {
    setStep("upload"); setDatasets([]);
    setUnitCol(""); setPriceCol(""); setSpjbCol(""); setStatusCol(""); setBumiCol("");
    setPasteText(""); setPasteError("");
    setTypeMap({}); setBedroomMap({}); setSqftMap({});
    setFilterType("ALL"); setBlockFilter("ALL"); setFloorFilter("ALL"); setUnitSearch(""); setUnitSearchStep2("");
    setSearchTerm(""); setSortOrder("asc"); setShowOnlyAnomalies(false);
    setActiveProjectId(null);
  };

  const handleBulkAssign = (unitNo, val) => {
    setTypeMap((prev) => {
      const next = { ...prev };
      uniqueUnitKeys.forEach((k) => { if (k.endsWith(`-${unitNo}`) || k === unitNo) next[k] = val; });
      return next;
    });
  };

  const handleTypeClick = (t) => { setFilterType(t); setSortOrder("asc"); setShowOnlyAnomalies(false); };

  const handleSaveProject = (overwriteId = null) => {
    const name = saveProjectName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    if (overwriteId) {
      // Update existing project's data + modifiedAt, keep original savedAt
      const updated = savedProjects.map((p) => p.id === overwriteId ? {
        ...p, name,
        modifiedAt: now,
        datasets: datasets.map((d) => ({ id: d.id, name: d.name, headers: d.headers, rows: d.rows })),
        unitCol, priceCol, spjbCol, statusCol, bumiCol,
        typeMap, bedroomMap, sqftMap,
      } : p);
      setSavedProjects(updated);
      localStorage.setItem("prc_saved_projects", JSON.stringify(updated));
      setActiveProjectId(overwriteId);
    } else {
      const id = Date.now();
      const project = {
        id, name,
        savedAt: now,
        modifiedAt: now,
        datasets: datasets.map((d) => ({ id: d.id, name: d.name, headers: d.headers, rows: d.rows })),
        unitCol, priceCol, spjbCol, statusCol, bumiCol,
        typeMap, bedroomMap, sqftMap,
      };
      const updated = [project, ...savedProjects];
      setSavedProjects(updated);
      localStorage.setItem("prc_saved_projects", JSON.stringify(updated));
      setActiveProjectId(id);
    }
    setShowSaveModal(false);
    setSaveProjectName("");
  };

  const handleDeleteProject = (id) => {
    const updated = savedProjects.filter((p) => p.id !== id);
    setSavedProjects(updated);
    localStorage.setItem("prc_saved_projects", JSON.stringify(updated));
    setDeleteConfirmId(null);
  };

  const handleExportProject = (project) => {
    try {
      const json = JSON.stringify(project, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name.replace(/[^a-z0-9]/gi, "_")}_prc.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
    } catch {
      // Fallback: data URI for environments that block createObjectURL
      const json = JSON.stringify(project, null, 2);
      const a = document.createElement("a");
      a.href = "data:application/json;charset=utf-8," + encodeURIComponent(json);
      a.download = `${project.name.replace(/[^a-z0-9]/gi, "_")}_prc.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 200);
    }
  };

  const handleExportCurrentProject = () => {
    const proj = savedProjects.find((p) => p.id === activeProjectId);
    if (proj) { handleExportProject(proj); return; }
    // If no saved project active, build an ad-hoc export from current state
    const tmp = {
      id: Date.now(), name: "Unsaved Project",
      savedAt: new Date().toISOString(), modifiedAt: new Date().toISOString(),
      datasets: datasets.map((d) => ({ id: d.id, name: d.name, headers: d.headers, rows: d.rows })),
      unitCol, priceCol, spjbCol, statusCol, bumiCol, typeMap, bedroomMap, sqftMap,
    };
    handleExportProject(tmp);
  };

  const handleImportProject = (file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const project = JSON.parse(ev.target.result);
        if (!project.datasets || !Array.isArray(project.datasets))
          throw new Error("Invalid project file");
        const imported = { ...project, id: Date.now(),
          savedAt: project.savedAt || new Date().toISOString(),
          modifiedAt: new Date().toISOString() };
        const updated = [imported, ...savedProjects];
        setSavedProjects(updated);
        localStorage.setItem("prc_saved_projects", JSON.stringify(updated));
        // Immediately open it
        handleLoadProject(imported);
      } catch {
        alert("Could not import — make sure this is a valid .json project file exported from this app.");
      }
    };
    reader.readAsText(file);
  };

  const handleLoadProject = (project) => {
    handleReset();
    setTimeout(() => {
      setDatasets(project.datasets);
      setUnitCol(project.unitCol || "");
      setPriceCol(project.priceCol || "");
      setSpjbCol(project.spjbCol || "");
      setStatusCol(project.statusCol || "");
      setBumiCol(project.bumiCol || "");
      setTypeMap(project.typeMap || {});
      setBedroomMap(project.bedroomMap || {});
      setSqftMap(project.sqftMap || {});
      setActiveProjectId(project.id);
      setStep("view");
    }, 50);
  };

  const handleExport = () => {
    const extraCols = ["Assigned Type", "Bedrooms", "Sold", "Anomaly"];
    const cols = [...allHeaders, ...extraCols];
    const csvRows = [cols.join(","), ...filtered.map((r) =>
      cols.map((c) => {
        if (c === "Assigned Type") return r._assignedType;
        if (c === "Bedrooms") return r._bedroom;
        if (c === "Sold") return r._sold ? "Yes" : "No";
        if (c === "Anomaly") return anomalySet.has(r._origIdx) ? "Yes" : "";
        return `"${(r[c] || "").replace(/"/g, '""')}"`;
      }).join(",")
    )];
    const dataUri = "data:text/csv;charset=utf-8," + encodeURIComponent(csvRows.join("\n"));
    const a = document.createElement("a");
    a.href = dataUri; a.download = "property_units.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const s = S;

  return (
    <div style={s.root}>
      {showAddBlock && (
        <AddBlockPanel
          onAdd={addDataset}
          onClose={() => setShowAddBlock(false)}
          existingHeaders={allHeaders}
        />
      )}

      {/* ── Edit Block Data Modal ── */}
      {editingDatasetId !== null && (() => {
        const ds = datasets.find((d) => d.id === editingDatasetId);
        if (!ds) return null;
        return (
          <div style={{ position:"fixed", inset:0, background:"#000000cc", zIndex:300,
            display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div style={{ background:"#13131f", border:"1px solid #2a2a40", borderRadius:16,
              padding:32, width:560, boxShadow:"0 24px 64px #00000080", display:"flex", flexDirection:"column", gap:14 }}>
              <div style={{ fontSize:17, fontWeight:700, color:"#fff" }}>✏️ Edit Block Data — {ds.name}</div>
              <div style={{ fontSize:13, color:"#555" }}>
                Paste updated data for this block. Your type assignments, bedroom config and all other settings will be preserved.
              </div>
              <textarea
                autoFocus
                style={{ background:"#0c0c18", border:"1px solid #2a2a40", color:"#ddd",
                  borderRadius:8, fontSize:12, padding:12, fontFamily:"monospace", resize:"vertical",
                  minHeight:220, outline:"none" }}
                placeholder={"Paste updated Excel data here (with headers on row 1)…"}
                value={editDataText}
                onChange={(e) => { setEditDataText(e.target.value); setEditDataError(""); }}
              />
              {editDataError && <div style={{ color:"#ff6b6b", fontSize:12 }}>⚠ {editDataError}</div>}
              <div style={{ display:"flex", gap:10 }}>
                <button style={{ ...s.btn, flex:1, marginTop:0, padding:"10px" }}
                  onClick={() => {
                    const text = editDataText.trim();
                    if (!text) { setEditDataError("Please paste data first."); return; }
                    const rows = parseCSV(text);
                    if (!rows.length) { setEditDataError("Could not parse — check headers are on row 1."); return; }
                    const headers = Object.keys(rows[0]);
                    setDatasets((prev) => prev.map((d) =>
                      d.id === editingDatasetId ? { ...d, headers, rows } : d
                    ));
                    setEditingDatasetId(null);
                    setEditDataText("");
                    setEditDataError("");
                  }}>
                  ✓ Update Block Data
                </button>
                <button style={{ ...s.ghostBtn, flex:1 }}
                  onClick={() => { setEditingDatasetId(null); setEditDataText(""); setEditDataError(""); }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Save Project Modal ── */}
      {showSaveModal && (() => {
        const activeProject = savedProjects.find((p) => p.id === activeProjectId);
        return (
          <div style={{ position:"fixed", inset:0, background:"#000000cc", zIndex:300,
            display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div style={{ background:"#13131f", border:"1px solid #2a2a40", borderRadius:16,
              padding:32, width:440, boxShadow:"0 24px 64px #00000080" }}>
              <div style={{ fontSize:17, fontWeight:700, color:"#fff", marginBottom:6 }}>💾 Save Project</div>
              <div style={{ fontSize:13, color:"#555", marginBottom:20 }}>
                {activeProject
                  ? <>Updating <strong style={{ color:"#ddd" }}>{activeProject.name}</strong>. Rename it below or save as a new entry.</>
                  : "Give this analysis a name so you can refer back to it later."}
              </div>
              <input
                autoFocus
                style={{ ...s.search, width:"100%", boxSizing:"border-box", fontSize:14,
                  padding:"10px 14px", marginBottom:12, borderColor:"#C9A84C44" }}
                placeholder="e.g. Residensi Bistari Block A — Feb 2026"
                value={saveProjectName}
                onChange={(e) => setSaveProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") activeProject ? handleSaveProject(activeProject.id) : handleSaveProject();
                  if (e.key === "Escape") setShowSaveModal(false);
                }}
              />
              {activeProject ? (
                <>
                  <button style={{ ...s.btn, width:"100%", marginTop:0, padding:"10px", marginBottom:10 }}
                    onClick={() => handleSaveProject(activeProject.id)}>
                    ↺ Update "{activeProject.name}"
                  </button>
                  <div style={{ display:"flex", gap:10 }}>
                    <button style={{ ...s.ghostBtn, flex:1, fontSize:12 }}
                      onClick={() => handleSaveProject()}>Save as New Copy</button>
                    <button style={{ ...s.ghostBtn, flex:1, fontSize:12 }}
                      onClick={() => { setShowSaveModal(false); setSaveProjectName(""); }}>Cancel</button>
                  </div>
                </>
              ) : (
                <div style={{ display:"flex", gap:10 }}>
                  <button style={{ ...s.btn, flex:1, marginTop:0, padding:"10px" }}
                    onClick={() => handleSaveProject()}>Save Project</button>
                  <button style={{ ...s.ghostBtn, flex:1 }}
                    onClick={() => { setShowSaveModal(false); setSaveProjectName(""); }}>Cancel</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Delete Confirm Modal ── */}
      {deleteConfirmId !== null && (
        <div style={{ position:"fixed", inset:0, background:"#000000cc", zIndex:300,
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:"#13131f", border:"1px solid #ff6b6b44", borderRadius:16,
            padding:32, width:380, boxShadow:"0 24px 64px #00000080" }}>
            <div style={{ fontSize:17, fontWeight:700, color:"#fff", marginBottom:8 }}>🗑 Delete Project?</div>
            <div style={{ fontSize:13, color:"#888", marginBottom:24 }}>
              "{savedProjects.find((p) => p.id === deleteConfirmId)?.name}" will be permanently removed. This cannot be undone.
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button style={{ ...s.btn, flex:1, marginTop:0, padding:"10px",
                background:"#ff6b6b", color:"#fff" }}
                onClick={() => handleDeleteProject(deleteConfirmId)}>Yes, Delete</button>
              <button style={{ ...s.ghostBtn, flex:1 }}
                onClick={() => setDeleteConfirmId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header style={s.header}>
        <div style={{ fontSize:22, color:"#C9A84C" }}>⬡</div>
        <div>
          <div style={s.brand}>Property Research Calculator</div>
          <div style={s.tagline}>Property Unit Intelligence</div>
        </div>
        <nav style={s.navSteps}>
          {[["upload","1","Import"],["map","2","Configure"],["view","3","Analyse"]].map(([st, num, lbl], idx) => {
            const active = step === st;
            const done = (st==="upload"&&(step==="map"||step==="view")) || (st==="map"&&step==="view");
            return (
              <div key={st} style={{ display:"flex", alignItems:"center", gap:0 }}>
                {idx > 0 && <div style={{ width:28, height:1, background:"#1e1e2e", margin:"0 4px" }} />}
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3,
                  cursor: done ? "pointer":"default" }}
                  onClick={() => { if (done) setStep(st); }}>
                  <div style={{ width:28, height:28, borderRadius:"50%", display:"flex",
                    alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700,
                    background: active?"#C9A84C": done?"#C9A84C33":"#1a1a2a",
                    color: active?"#0c0c18": done?"#C9A84C":"#555",
                    border: done&&!active?"1px solid #C9A84C44":"none" }}>
                    {done && !active ? "✓" : num}
                  </div>
                  <span style={{ fontSize:10, color: active?"#C9A84C":done?"#C9A84C77":"#444", letterSpacing:0.5 }}>{lbl}</span>
                </div>
              </div>
            );
          })}
        </nav>
        {datasets.length > 0 && (
          <div style={{ display:"flex", gap:8, marginLeft:12, alignItems:"center" }}>
            {step !== "upload" && (
              <button style={{ ...s.ghostBtn, fontSize:12, padding:"6px 12px", color:"#4C8EC9", borderColor:"#4C8EC944" }}
                onClick={() => setShowAddBlock(true)}>
                ➕ Add Block
              </button>
            )}
            <button style={{ ...s.ghostBtn, fontSize:12, padding:"6px 12px", color:"#ff6b6b", borderColor:"#ff6b6b33" }}
              onClick={handleReset}>✕ Reset</button>
          </div>
        )}
      </header>

      <div style={{ ...s.body, padding: step === "upload" ? 0 : "24px 32px" }}>

        {/* ══ STEP 1: Upload ══ */}
        {step === "upload" && (
      <div style={{ display:"flex", gap:0, minHeight:"calc(100vh - 65px)", flex:1 }}>

            {/* Left: branding / instructions panel */}
            <div style={{ flex:"0 0 42%", background:"#0e0e1c", borderRight:"1px solid #1a1a2e",
              padding:"48px 40px", display:"flex", flexDirection:"column", justifyContent:"center" }}>
              <div style={{ fontSize:11, color:"#C9A84C", letterSpacing:3, textTransform:"uppercase", marginBottom:16 }}>
                Property Research Calculator
              </div>
              <h1 style={{ fontSize:36, fontWeight:800, color:"#fff", lineHeight:1.2, margin:"0 0 20px" }}>
                Analyse property<br />
                <span style={{ color:"#C9A84C" }}>unit data faster.</span>
              </h1>
              <p style={{ fontSize:14, color:"#666", lineHeight:1.8, margin:"0 0 32px", maxWidth:400 }}>
                Import your Excel or CSV data to instantly assign unit types, track sales status, calculate bedroom distributions, spot price anomalies, and generate charts — all without formulas.
              </p>

              {/* Step guide */}
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                {[
                  ["1", "Import", "Paste from Excel or upload a .csv file"],
                  ["2", "Configure", "Assign unit types, bedrooms, columns"],
                  ["3", "Analyse", "Filter, sort, spot anomalies, view charts"],
                ].map(([num, title, desc]) => (
                  <div key={num} style={{ display:"flex", alignItems:"flex-start", gap:14 }}>
                    <div style={{ width:28, height:28, borderRadius:"50%", background:"#C9A84C22",
                      border:"1px solid #C9A84C44", display:"flex", alignItems:"center",
                      justifyContent:"center", fontSize:12, fontWeight:800, color:"#C9A84C", flexShrink:0, marginTop:1 }}>
                      {num}
                    </div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:"#ddd" }}>{title}</div>
                      <div style={{ fontSize:12, color:"#555", marginTop:2 }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop:40, padding:"16px 20px", background:"#13131f",
                border:"1px solid #1e1e2e", borderRadius:12 }}>
                <div style={{ fontSize:11, color:"#555", letterSpacing:0.5, textTransform:"uppercase", marginBottom:8 }}>
                  Expected columns
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {["No Unit","Harga Jualan (RM)","Harga SPJB (RM)","Status Jualan","Kuota Bumi"].map((c) => (
                    <code key={c} style={{ background:"#0c0c18", color:"#C9A84C88", border:"1px solid #1e1e2e",
                      borderRadius:4, padding:"2px 8px", fontSize:11 }}>{c}</code>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: import area */}
            <div style={{ flex:1, padding:"48px 40px", display:"flex", flexDirection:"column", justifyContent:"center" }}>
              <div style={{ fontSize:18, fontWeight:700, color:"#fff", marginBottom:6 }}>Import Your Data</div>
              <div style={{ fontSize:13, color:"#666", marginBottom:24 }}>
                In Excel: select all cells including headers → <kbd style={{ background:"#1e1e2e", border:"1px solid #2a2a40",
                  borderRadius:4, padding:"1px 6px", fontSize:11, color:"#aaa" }}>Ctrl+C</kbd> → paste below.
              </div>


              <label style={{ display:"block", marginBottom:4 }}>
                <input type="file" accept=".csv,.tsv,.txt,.json"
                  onChange={(e) => {
                    const f = e.target.files[0]; if (!f) return;
                    if (f.name.endsWith(".json")) {
                      handleImportProject(f);
                    } else {
                      const reader = new FileReader();
                      reader.onload = (ev) => { setPasteText(ev.target.result); processFirstDataset(ev.target.result, f.name.replace(/\.[^.]+$/, "")); };
                      reader.readAsText(f);
                    }
                    e.target.value = "";
                  }}
                  style={{ display:"none" }} />
                <span style={{ ...s.fileBtn, display:"inline-flex", alignItems:"center", gap:8, fontSize:13, cursor:"pointer" }}>
                  📂 Upload File
                  <span style={{ color:"#555", fontSize:11 }}>.csv · .tsv · .txt · .json</span>
                </span>
              </label>

              <div style={s.divider}><span style={s.dividerTxt}>or paste directly</span></div>

              <textarea style={{ ...s.textarea, flex:1, minHeight:260, resize:"none" }}
                placeholder={"Paste your Excel data here...\n\nMake sure row 1 contains column headers like:\nBil\tNo PT/Lot\tNo Unit\tUnit Type\tHarga Jualan (RM)\tHarga SPJB (RM)\tStatus Jualan\tKuota Bumi"}
                value={pasteText} onChange={(e) => setPasteText(e.target.value)} />

              {pasteError && <div style={{ ...s.error, marginTop:10 }}>⚠ {pasteError}</div>}

              <button style={{ ...s.btn, marginTop:16, width:"100%", padding:"14px", fontSize:15 }}
                onClick={() => processFirstDataset(pasteText)}>
                Parse Data & Continue →
              </button>

              {/* ── Saved Projects ── */}
              {savedProjects.length > 0 && (
                <div style={{ marginTop:36 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#fff", marginBottom:10,
                    display:"flex", alignItems:"center", gap:8 }}>
                    <span>🗂 Saved Projects</span>
                    <span style={{ fontSize:11, color:"#555", fontWeight:400 }}>({savedProjects.length})</span>
                  </div>
                  <input
                    style={{ ...s.search, width:"100%", boxSizing:"border-box", marginBottom:10, fontSize:12 }}
                    placeholder="🔍 Search saved projects…"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                  />
                  <div style={{ display:"flex", flexDirection:"column", gap:8, maxHeight:300, overflowY:"auto" }}>
                    {savedProjects
                      .filter((p) => !projectSearch || p.name.toLowerCase().includes(projectSearch.toLowerCase()))
                      .map((p) => (
                      <div key={p.id} style={{ background:"#13131f", border:"1px solid #1e1e2e",
                        borderRadius:10, padding:"12px 16px", display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:700, color:"#ddd",
                            whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.name}</div>
                          <div style={{ fontSize:11, color:"#555", marginTop:2 }}>
                            {new Date(p.savedAt).toLocaleDateString("en-MY", { day:"numeric", month:"short", year:"numeric" })}
                            {p.modifiedAt && p.modifiedAt !== p.savedAt && (
                              <span style={{ color:"#C9A84C88" }}> · modified {new Date(p.modifiedAt).toLocaleDateString("en-MY", { day:"numeric", month:"short", year:"numeric" })}</span>
                            )}
                            {" · "}{p.datasets?.reduce((s, d) => s + d.rows.length, 0)} units
                          </div>
                        </div>
                        <button onClick={() => handleLoadProject(p)}
                          style={{ background:"#C9A84C22", border:"1px solid #C9A84C44",
                            color:"#C9A84C", borderRadius:6, padding:"5px 12px",
                            fontSize:12, cursor:"pointer", fontWeight:600, whiteSpace:"nowrap" }}>
                          Open →
                        </button>
                        <button onClick={() => handleExportProject(p)}
                          title="Export as .json"
                          style={{ background:"#13131f", border:"1px solid #4C8EC944",
                            color:"#4C8EC9", borderRadius:6, padding:"5px 10px",
                            fontSize:12, cursor:"pointer", whiteSpace:"nowrap" }}>
                          ↓
                        </button>
                        <button onClick={() => setDeleteConfirmId(p.id)}
                          style={{ background:"none", border:"1px solid #ff6b6b22",
                            color:"#ff6b6b55", borderRadius:6, padding:"5px 10px",
                            fontSize:12, cursor:"pointer" }}>
                          🗑
                        </button>
                      </div>
                    ))}
                    {projectSearch && savedProjects.filter((p) => p.name.toLowerCase().includes(projectSearch.toLowerCase())).length === 0 && (
                      <div style={{ color:"#555", fontSize:12, padding:"12px 0", textAlign:"center" }}>
                        No projects match "{projectSearch}"
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ STEP 2: Configure ══ */}
        {step === "map" && (
          <div>
            <BackBtn onClick={handleReset} label="← Start Over / New Data" />

            {/* Dataset pills */}
            <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap", alignItems:"center" }}>
              {datasets.map((d) => (
                <div key={d.id} style={{ background:"#13131f", border:"1px solid #2a2a40",
                  borderRadius:8, padding:"6px 14px", fontSize:13, display:"flex", gap:10, alignItems:"center" }}>
                  <span style={{ color:"#4C8EC9" }}>📦</span>
                  <span style={{ color:"#ccc" }}>{d.name}</span>
                  <span style={{ color:"#555", fontSize:11 }}>{d.rows.length} rows</span>
                  <button
                    onClick={() => { setEditingDatasetId(d.id); setEditDataText(""); setEditDataError(""); }}
                    style={{ background:"#1a2a1a", border:"1px solid #22c55e33", color:"#22c55e",
                      borderRadius:5, padding:"2px 9px", fontSize:11, cursor:"pointer", fontWeight:600 }}>
                    ✏️ Edit
                  </button>
                  {datasets.length > 1 && (
                    <button onClick={() => removeDataset(d.id)}
                      style={{ background:"none", border:"none", color:"#ff6b6b44", cursor:"pointer", fontSize:14, padding:0 }}>✕</button>
                  )}
                </div>
              ))}
              <button style={{ ...s.ghostBtn, fontSize:12, color:"#4C8EC9", borderColor:"#4C8EC944", padding:"6px 14px" }}
                onClick={() => setShowAddBlock(true)}>
                ➕ Add Another Block
              </button>
            </div>

            {/* Sales Status Preview (Step 2) */}
            {statusCol && Object.keys(salesByBlock).length > 0 && (
              <div style={{ ...s.card, padding:"18px 24px", marginBottom:20 }}>
                <SectionHead>📊 Sales Status Preview</SectionHead>
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:8 }}>
                  {Object.entries(salesByBlock).map(([blk, { sold, total }], i) => (
                    <SalesCard key={blk} label={`Block ${blk}`} sold={sold} total={total}
                      color={TYPE_COLOURS[i % TYPE_COLOURS.length]} />
                  ))}
                  {Object.keys(salesByBlock).length > 1 && (
                    <SalesCard label="Overall" sold={salesOverall.sold} total={salesOverall.total} color="#C9A84C" />
                  )}
                </div>
              </div>
            )}

            <div style={{ display:"flex", gap:24, alignItems:"stretch" }}>
              {/* Left panel */}
              <div style={{ ...s.card, flex:"0 0 390px", overflowY:"auto", marginBottom:0 }}>
                <div style={s.cardTitle}>Unit Type Setup</div>

                {/* Column pickers */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:20 }}>
                  {[["Unit No. Column", unitCol, setUnitCol],
                    ["Display Price Col", priceCol, setPriceCol],
                    ["SPJB Price Col", spjbCol, setSpjbCol],
                    ["Status Column", statusCol, setStatusCol],
                    ["Bumi Quota Col", bumiCol, setBumiCol],
                  ].map(([lbl, val, setter]) => (
                    <div key={lbl}>
                      <div style={s.label}>{lbl}</div>
                      <select style={s.select} value={val}
                        onChange={(e) => setter(e.target.value)}>
                        <option value="">— None —</option>
                        {allHeaders.map((h) => <option key={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>

                {/* Bulk assign */}
                <SectionHead>⚡ Bulk Assign — by Unit Number</SectionHead>
                <div style={{ ...s.cardSub, marginTop:2 }}>
                  Applies to matching unit numbers across all blocks simultaneously.
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:22 }}>
                  {uniqueUnitNos.map((uNo) => (
                    <div key={uNo} style={s.mapRow}>
                      <code style={s.unitTag}>Unit {uNo}</code>
                      <span style={{ color:"#333", fontSize:11, flex:1 }}>→ all blocks</span>
                      <input style={s.typeInput} placeholder="e.g. A1"
                        onBlur={(e) => handleBulkAssign(uNo, e.target.value)}
                        defaultValue={(() => {
                          const m = uniqueUnitKeys.filter((k) => k.endsWith(`-${uNo}`) || k === uNo);
                          const v = [...new Set(m.map((k) => typeMap[k] || ""))];
                          return v.length === 1 ? v[0] : "";
                        })()} />
                    </div>
                  ))}
                </div>

                {/* Fine-tune */}
                <SectionHead>🎯 Fine-tune — Block + Unit</SectionHead>
                <div style={{ ...s.cardSub, marginTop:2 }}>
                  Overrides the bulk assignment for a specific block-unit pair (e.g. C-01, D-07).
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:22 }}>
                  {uniqueUnitKeys.map((key) => {
                    const hasType = !!typeMap[key];
                    return (
                      <div key={key} style={{ ...s.mapRow,
                        borderColor: hasType ? typeColor(typeMap[key], allTypes) + "44" : "#1a1a2e",
                        background: hasType ? typeColor(typeMap[key], allTypes) + "0a" : "#0c0c18",
                      }}>
                        <code style={s.unitTag}>{key}</code>
                        {hasType && <Badge color={typeColor(typeMap[key], allTypes)} label={typeMap[key]} />}
                        <input style={{ ...s.typeInput, marginLeft:"auto" }} placeholder="Type..."
                          value={typeMap[key] || ""}
                          onChange={(e) => setTypeMap((p) => ({ ...p, [key]: e.target.value }))} />
                      </div>
                    );
                  })}
                </div>

                {/* ── Search & Override a specific unit by full code ── */}
                <SectionHead>🔎 Search & Override — Specific Unit</SectionHead>
                <div style={{ ...s.cardSub, marginTop:2 }}>
                  Search by full unit code including floor (e.g. <code style={s.code}>B-11-07</code>). Results appear as you type — click a result to assign or change its type independently.
                </div>
                <UnitOverrideSearch
                  parsedUnits={parsedUnits}
                  typeMap={typeMap}
                  setTypeMap={setTypeMap}
                  allTypes={allTypes}
                  typeColor={typeColor}
                />

                {/* Explicit override log — full-code keys set via the search above */}
                {(() => {
                  const overrides = Object.entries(typeMap).filter(([key]) => {
                    const p = parseUnitCode(key);
                    return p && p.floor; // has a floor → full code override
                  });
                  if (!overrides.length) return null;
                  return (
                    <div style={{ marginTop:10, marginBottom:6 }}>
                      <div style={{ fontSize:11, color:"#555", letterSpacing:0.5,
                        textTransform:"uppercase", marginBottom:6, display:"flex", alignItems:"center", gap:8 }}>
                        <span>📌 Pinned Unit Overrides</span>
                        <span style={{ background:"#C9A84C22", color:"#C9A84C", borderRadius:10,
                          padding:"1px 7px", fontSize:10, fontWeight:700 }}>{overrides.length}</span>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:180, overflowY:"auto" }}>
                        {overrides.map(([key, type]) => {
                          const col = typeColor(type, allTypes);
                          return (
                            <div key={key} style={{ display:"flex", alignItems:"center", gap:8,
                              background:"#0f0f1e", border:`1px solid ${col}33`,
                              borderRadius:6, padding:"5px 10px" }}>
                              <code style={{ fontSize:11, color:"#aaa", flex:1 }}>{key}</code>
                              <span style={{ fontSize:11, background:col+"22", color:col,
                                border:`1px solid ${col}44`, borderRadius:4, padding:"1px 7px",
                                fontWeight:700, fontFamily:"monospace" }}>{type}</span>
                              <button
                                onClick={() => setTypeMap((p) => { const n={...p}; delete n[key]; return n; })}
                                style={{ background:"none", border:"none", color:"#ff6b6b55",
                                  cursor:"pointer", fontSize:13, padding:"0 2px", lineHeight:1 }}
                                title="Remove override">✕</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Bedroom */}
                {allTypes.length > 0 && (
                  <>
                    <SectionHead>🛏 Bedroom Count — per Type</SectionHead>
                    <div style={{ ...s.cardSub, marginTop:2 }}>
                      Format: <code style={s.code}>3R</code> / <code style={s.code}>3+1R</code> / <code style={s.code}>4R</code>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:8 }}>
                      {allTypes.map((t) => (
                        <div key={t} style={{ ...s.mapRow, background:"#0f0f1e" }}>
                          <Badge color={typeColor(t, allTypes)} label={`Type ${t}`} />
                          <input style={{ ...s.typeInput, width:80 }} placeholder="e.g. 3+1R"
                            value={bedroomMap[t] || ""}
                            onChange={(e) => setBedroomMap((p) => ({ ...p, [t]: e.target.value }))} />
                        </div>
                      ))}
                    </div>

                    <SectionHead>📐 Square Footage — per Type</SectionHead>
                    <div style={{ ...s.cardSub, marginTop:2 }}>
                      Used to calculate <strong style={{ color:"#C9A84C" }}>PSF</strong> (price per sq ft) on the sales chart. Enter built-up area in sq ft.
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:8 }}>
                      {allTypes.map((t) => (
                        <div key={t} style={{ ...s.mapRow, background:"#0f0f1e" }}>
                          <Badge color={typeColor(t, allTypes)} label={`Type ${t}`} />
                          <input style={{ ...s.typeInput, width:80 }} placeholder="e.g. 900"
                            value={sqftMap[t] || ""}
                            onChange={(e) => {
                              const v = e.target.value.replace(/[^0-9]/g, "");
                              setSqftMap((p) => ({ ...p, [t]: v }));
                            }} />
                          <span style={{ fontSize:11, color:"#444" }}>sf</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <button style={{ ...s.btn, width:"100%", marginTop:18 }} onClick={() => setStep("view")}>
                  View Full Analysis →
                </button>
              </div>

              {/* Right: live preview */}
              <div style={{ ...s.card, flex:1, minWidth:0, marginBottom:0 }}>
                <div style={s.cardTitle}>Live Preview
                  <span style={{ fontSize:13, color:"#555", fontWeight:400, marginLeft:8 }}>({rawRows.length} total rows)</span>
                </div>
                <div style={{ overflowX:"auto" }}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        {allHeaders.map((h) => <th key={h} style={s.th}>{h}</th>)}
                        <th style={{ ...s.th, color:"#C9A84C" }}>Type</th>
                        <th style={{ ...s.th, color:"#84C94C" }}>Bedrooms</th>
                        {statusCol && <th style={{ ...s.th, color:"#22c55e" }}>Sold?</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {enrichedRows.slice(0,30).map((row, i) => (
                        <tr key={i} style={i%2===0?s.trEven:{}}>
                          {allHeaders.map((h) => (
                            <td key={h} style={s.td}>
                              {priceCol && h===priceCol
                                ? <span style={{ fontFamily:"monospace", color:"#C9A84C" }}>{formatPrice(row[h])}</span>
                                : row[h]}
                            </td>
                          ))}
                          <td style={s.td}>
                            {row._assignedType ? <Badge color={typeColor(row._assignedType, allTypes)} label={row._assignedType} /> : <span style={{ color:"#2a2a3a" }}>—</span>}
                          </td>
                          <td style={s.td}>
                            <span style={{ color:"#84C94C", fontWeight:700, fontSize:12 }}>{row._bedroom || <span style={{ color:"#2a2a3a" }}>—</span>}</span>
                          </td>
                          {statusCol && (
                            <td style={s.td}>
                              <span style={{ fontSize:11, fontWeight:700,
                                color: row._sold ? "#84C94C" : "#ff6b6b" }}>
                                {row._sold ? "✓ Sold" : "Available"}
                              </span>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {enrichedRows.length > 30 && (
                    <div style={{ color:"#333", fontSize:12, padding:"8px 14px" }}>+ {enrichedRows.length - 30} more rows…</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ STEP 3: Analyse ══ */}
        {step === "view" && (
          <div>
            <BackBtn onClick={() => setStep("map")} label="← Edit Configuration" />

            {/* ── Top panels row ── */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:20 }}>

              {/* Sales Status */}
              {statusCol && (
                <div style={{ ...s.card, padding:"18px 24px" }}>
                  <SectionHead>📊 Sales Status by Block</SectionHead>
                  <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:10 }}>
                    {Object.entries(salesByBlock).map(([blk, { sold, total }], i) => (
                      <SalesCard key={blk} label={`Block ${blk}`} sold={sold} total={total}
                        color={TYPE_COLOURS[i % TYPE_COLOURS.length]} />
                    ))}
                    {Object.keys(salesByBlock).length > 1 && (
                      <SalesCard label="Overall" sold={salesOverall.sold} total={salesOverall.total} color="#C9A84C" />
                    )}
                  </div>
                </div>
              )}

              {/* Bedroom distribution */}
              {bedroomDist.length > 0 && (
                <div style={{ ...s.card, padding:"18px 24px" }}>
                  <SectionHead>🛏 Bedroom Distribution — All Units ({rawRows.length})</SectionHead>
                  <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:10 }}>
                    {bedroomDist.map(({ label, count, pct }) => (
                      <div key={label} style={{ background:"#0e0e1c", border:"1px solid #1e1e2e",
                        borderRadius:10, padding:"12px 16px", minWidth:100, flex:"0 0 auto" }}>
                        <div style={{ fontSize:22, fontWeight:800, color:"#84C94C" }}>{label}</div>
                        <div style={{ fontSize:10, color:"#555", letterSpacing:0.5, textTransform:"uppercase" }}>bedrooms</div>
                        <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:6 }}>
                          <span style={{ fontSize:18, fontWeight:800, color:"#fff" }}>{count}</span>
                          <span style={{ fontSize:11, color:"#555" }}>units</span>
                        </div>
                        <div style={{ fontSize:20, fontWeight:800, color:"#C9A84C" }}>{pct}%</div>
                        <div style={{ height:4, background:"#1e1e2e", borderRadius:2, marginTop:6, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${pct}%`, background:"#84C94C", borderRadius:2 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bumi stats */}
              {bumiStats && (
                <div style={{ ...s.card, padding:"18px 24px" }}>
                  <SectionHead>🏠 Bumi Quota Distribution (Sold Units)</SectionHead>
                  <div style={{ fontSize:11, color:"#555", marginBottom:10 }}>
                    Bumi status activates on sale — counts sold units only.
                  </div>
                  <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:4 }}>
                    <div style={{ background:"#0e0e1c", border:"1px solid #22c55e22", borderRadius:10, padding:"14px 18px", minWidth:130 }}>
                      <div style={{ fontSize:28, fontWeight:800, color:"#22c55e" }}>{bumiStats.pctOfSold}%</div>
                      <div style={{ fontSize:11, color:"#555", letterSpacing:0.5, textTransform:"uppercase" }}>Bumi sold</div>
                      <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:6 }}>
                        <span style={{ fontSize:18, fontWeight:800, color:"#fff" }}>{bumiStats.bumiSold}</span>
                        <span style={{ fontSize:11, color:"#555" }}>of {bumiStats.totalSold} sold</span>
                      </div>
                      <div style={{ height:4, background:"#1e1e2e", borderRadius:2, marginTop:8, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${bumiStats.pctOfSold}%`, background:"#22c55e", borderRadius:2 }} />
                      </div>
                    </div>
                    <div style={{ background:"#0e0e1c", border:"1px solid #C94C8422", borderRadius:10, padding:"14px 18px", minWidth:130 }}>
                      <div style={{ fontSize:28, fontWeight:800, color:"#C94C84" }}>
                        {bumiStats.totalSold > 0 ? (100 - parseFloat(bumiStats.pctOfSold)).toFixed(1) : "0.0"}%
                      </div>
                      <div style={{ fontSize:11, color:"#555", letterSpacing:0.5, textTransform:"uppercase" }}>Non-Bumi sold</div>
                      <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:6 }}>
                        <span style={{ fontSize:18, fontWeight:800, color:"#fff" }}>{bumiStats.nonBumiSold}</span>
                        <span style={{ fontSize:11, color:"#555" }}>of {bumiStats.totalSold} sold</span>
                      </div>
                      <div style={{ height:4, background:"#1e1e2e", borderRadius:2, marginTop:8, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${bumiStats.totalSold > 0 ? (100 - parseFloat(bumiStats.pctOfSold)).toFixed(1) : 0}%`, background:"#C94C84", borderRadius:2 }} />
                      </div>
                    </div>
                    <div style={{ background:"#0e0e1c", border:"1px solid #2a2a3a", borderRadius:10, padding:"14px 18px", minWidth:130 }}>
                      <div style={{ fontSize:28, fontWeight:800, color:"#C9A84C" }}>{bumiStats.bumiSoldOfSlots}%</div>
                      <div style={{ fontSize:11, color:"#555", letterSpacing:0.5, textTransform:"uppercase" }}>Quota filled</div>
                      <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:6 }}>
                        <span style={{ fontSize:18, fontWeight:800, color:"#fff" }}>{bumiStats.bumiSold}</span>
                        <span style={{ fontSize:11, color:"#555" }}>of {bumiStats.allBumiSlots} slots</span>
                      </div>
                      <div style={{ height:4, background:"#1e1e2e", borderRadius:2, marginTop:8, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${bumiStats.bumiSoldOfSlots}%`, background:"#C9A84C", borderRadius:2 }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Type filter chips ── */}
            <div style={s.statsBar}>
              <div style={{ ...s.statChip, borderColor: filterType==="ALL"?"#C9A84C":"#1e1e2e" }}
                onClick={() => handleTypeClick("ALL")}>
                <span style={s.statNum}>{rawRows.length}</span>
                <span style={s.statLbl}>All Units</span>
                {statusCol && (
                  <span style={{ fontSize:10, color:"#84C94C", marginTop:2 }}>
                    {salesOverall.sold} sold
                  </span>
                )}
              </div>
              {allTypes.map((t) => {
                const col = typeColor(t, allTypes);
                const ts = typeStats[t] || { total: 0, sold: 0 };
                return (
                  <div key={t}
                    style={{ ...s.statChip, borderColor: filterType===t?col:"#1e1e2e",
                      background: filterType===t?col+"18":"#13131f" }}
                    onClick={() => handleTypeClick(t)}>
                    <span style={{ ...s.statNum, color: col }}>{ts.total}</span>
                    <span style={s.statLbl}>Type {t}</span>
                    {bedroomMap[t] && <span style={{ fontSize:10, color:col+"99", marginTop:1 }}>{bedroomMap[t]}</span>}
                    {statusCol && (
                      <span style={{ fontSize:10, color:"#84C94C", marginTop:2 }}>
                        {ts.sold} sold
                        {ts.total > 0 && (
                          <span style={{ color:"#555" }}> ({((ts.sold/ts.total)*100).toFixed(0)}%)</span>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
              {(typeStats["Unassigned"]?.total || 0) > 0 && (
                <div style={{ ...s.statChip, borderColor: filterType==="Unassigned"?"#ff6b6b33":"#1e1e2e" }}
                  onClick={() => handleTypeClick("Unassigned")}>
                  <span style={{ ...s.statNum, color:"#555" }}>{typeStats["Unassigned"]?.total}</span>
                  <span style={s.statLbl}>Unassigned</span>
                </div>
              )}
            </div>

            {/* ── Toolbar ── */}
            <div style={{ ...s.toolbar, flexWrap:"wrap", gap:10, marginBottom:12 }}>
              <input style={s.search} placeholder="🔍 Search any field..."
                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />

              {/* Block filter */}
              {uniqueBlocks.length > 0 && (
                <select style={{ ...s.select, width:"auto", minWidth:130 }}
                  value={blockFilter} onChange={(e) => setBlockFilter(e.target.value)}>
                  <option value="ALL">All Blocks</option>
                  {uniqueBlocks.map((b) => <option key={b} value={b}>Block {b}</option>)}
                </select>
              )}

              {/* Floor filter */}
              {uniqueFloors.length > 0 && (
                <select style={{ ...s.select, width:"auto", minWidth:120 }}
                  value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)}>
                  <option value="ALL">All Floors</option>
                  {uniqueFloors.map((f) => <option key={f}>Floor {f}</option>)}
                </select>
              )}

              {/* Unit search */}
              <div style={{ position:"relative" }}>
                <input
                  style={{ ...s.search, width:180 }}
                  placeholder="Units: 01-10 or 01,05,09"
                  value={unitSearch}
                  onChange={(e) => setUnitSearch(e.target.value)}
                />
              </div>

              {(spjbCol || priceCol) && (
                <button
                  style={{ ...s.ghostBtn, color:"#C9A84C", borderColor:"#C9A84C44", minWidth:168 }}
                  onClick={() => setSortOrder((o) => o==="asc"?"desc":"asc")}>
                  {sortOrder==="asc" ? "↑ SPJB: Low → High" : "↓ SPJB: High → Low"}
                </button>
              )}
              <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center" }}>
                {anomalyCount > 0 && (
                  <button
                    onClick={() => setShowOnlyAnomalies((v) => !v)}
                    style={{
                      background: showOnlyAnomalies ? "#ff444422" : "#ff444411",
                      border: `1px solid ${showOnlyAnomalies ? "#ff4444" : "#ff444433"}`,
                      borderRadius:8, padding:"6px 14px", fontSize:12,
                      color: showOnlyAnomalies ? "#ff4444" : "#ff8888",
                      cursor:"pointer", fontWeight: showOnlyAnomalies ? 700 : 400,
                      display:"flex", alignItems:"center", gap:6,
                    }}>
                    ⚠ {anomalyCount} anomal{anomalyCount===1?"y":"ies"}
                    <span style={{ fontSize:10, opacity:0.7 }}>
                      {showOnlyAnomalies ? "— click to clear" : "— click to isolate"}
                    </span>
                  </button>
                )}
                {(() => {
                  const proj = savedProjects.find((p) => p.id === activeProjectId);
                  if (!proj) return null;
                  const dt = proj.modifiedAt || proj.savedAt;
                  return (
                    <span style={{ fontSize:11, color:"#444", whiteSpace:"nowrap" }}>
                      💾 <span style={{ color:"#555" }}>{proj.name}</span>
                      <span style={{ color:"#333", marginLeft:6 }}>
                        · last saved {new Date(dt).toLocaleDateString("en-MY", { day:"numeric", month:"short", year:"numeric" })}
                      </span>
                    </span>
                  );
                })()}
                <button style={{ ...s.ghostBtn, color:"#84C94C", borderColor:"#84C94C44" }}
                  onClick={() => {
                    const proj = savedProjects.find((p) => p.id === activeProjectId);
                    setSaveProjectName(proj?.name || "");
                    setShowSaveModal(true);
                  }}>
                  💾 Save Project
                </button>
                <button style={{ ...s.ghostBtn, color:"#4C8EC9", borderColor:"#4C8EC944" }}
                  onClick={handleExportCurrentProject}
                  title="Export project as .json to share with others">
                  ↓ Export Project
                </button>
              </div>
            </div>

            <div style={{ fontSize:12, color:"#444", marginBottom:10 }}>
              Showing <strong style={{ color:"#C9A84C" }}>{filteredFinal.length}</strong> of {rawRows.length} units
              {filterType !== "ALL" && <> · type <strong style={{ color:"#C9A84C" }}>{filterType}</strong></>}
              {blockFilter !== "ALL" && <> · <strong style={{ color:"#4C8EC9" }}>Block {blockFilter}</strong></>}
              {floorFilter !== "ALL" && <> · <strong style={{ color:"#4C8EC9" }}>{floorFilter}</strong></>}
              {unitSearch && <> · unit filter <code style={{ color:"#C9A84C", background:"#1e1e2e", padding:"1px 5px", borderRadius:3, fontSize:11 }}>{unitSearch}</code></>}
              {showOnlyAnomalies && <> · <span style={{ color:"#ff4444", fontWeight:700 }}>⚠ anomalies only</span></>}
              {priceCol && <span style={{ color:"#2a2a4a" }}> · {sortOrder==="asc"?"↑ asc":"↓ desc"} price</span>}
            </div>

            {/* Anomaly legend */}
            {anomalyCount > 0 && (
              <div style={{ background: showOnlyAnomalies ? "#1a0808" : "#ff6b6b08",
                border:`1px solid ${showOnlyAnomalies ? "#ff444444" : "#ff6b6b22"}`,
                borderRadius:8, padding:"8px 14px", fontSize:12, color:"#888", marginBottom:10,
                display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                <span>
                  <span style={{ color:"#ff4444", fontWeight:700 }}>⚠ Anomaly:</span>{" "}
                  Units priced <strong style={{ color:"#fff" }}>±30% or more</strong> from their type's median SPJB price. May indicate special discounts or premium units.
                </span>
                {showOnlyAnomalies && (
                  <button onClick={() => setShowOnlyAnomalies(false)}
                    style={{ background:"#ff444422", border:"1px solid #ff444444", borderRadius:6,
                      padding:"4px 12px", fontSize:11, color:"#ff4444", cursor:"pointer",
                      fontWeight:700, whiteSpace:"nowrap" }}>
                    ✕ Clear filter
                  </button>
                )}
              </div>
            )}

            {/* ── Results table ── */}
            <div style={{ overflowX:"auto", borderRadius:12, border:"1px solid #1a1a2e" }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    {allHeaders.map((h) => {
                      const isSortCol = spjbCol ? h === spjbCol : (priceCol && h === priceCol);
                      const isPriceDisplay = (priceCol && h === priceCol) || (spjbCol && h === spjbCol);
                      return (
                        <th key={h} style={{
                          ...s.th,
                          color: isSortCol ? "#C9A84C" : isPriceDisplay ? "#C9A84C88" : undefined,
                          cursor: isSortCol ? "pointer" : "default",
                        }}
                          onClick={() => { if (isSortCol) setSortOrder((o) => o==="asc"?"desc":"asc"); }}>
                          {h}{isSortCol ? (sortOrder==="asc"?" ↑":" ↓") : ""}
                        </th>
                      );
                    })}
                    <th style={{ ...s.th, color:"#C9A84C" }}>Type</th>
                    <th style={{ ...s.th, color:"#84C94C" }}>Bedrooms</th>
                    {statusCol && <th style={{ ...s.th, color:"#22c55e" }}>Status</th>}
                    <th style={{ ...s.th, color:"#4C8EC9" }}>Block</th>
                    <th style={{ ...s.th, color:"#4C8EC9" }}>Floor</th>
                    <th style={{ ...s.th, color:"#4C8EC9" }}>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFinal.map((row, i) => {
                    const isAnomaly = anomalySet.has(row._origIdx);
                    const rowStyle = isAnomaly
                      ? { background: "#1a0808", borderLeft:"3px solid #ff4444" }
                      : i%2===0 ? s.trEven : {};
                    return (
                      <tr key={i} style={rowStyle}>
                        {allHeaders.map((h) => {
                          const isSpjbCol = spjbCol && h === spjbCol;
                          const isPriceCol = priceCol && h === priceCol;
                          return (
                            <td key={h} style={s.td}>
                              {(isPriceCol || isSpjbCol)
                                ? <span style={{ fontFamily:"monospace",
                                    color: isAnomaly && isSpjbCol ? "#ff4444" : "#C9A84C",
                                    fontWeight:600 }}>
                                    {formatPrice(row[h])}{isAnomaly && isSpjbCol ? " ⚠" : ""}
                                  </span>
                                : row[h]}
                            </td>
                          );
                        })}
                        <td style={s.td}>
                          {row._assignedType
                            ? <Badge color={typeColor(row._assignedType, allTypes)} label={row._assignedType} />
                            : <span style={{ color:"#2a2a3a" }}>—</span>}
                        </td>
                        <td style={s.td}>
                          <span style={{ color:"#84C94C", fontWeight:700, fontSize:12 }}>
                            {row._bedroom || <span style={{ color:"#2a2a3a" }}>—</span>}
                          </span>
                        </td>
                        {statusCol && (
                          <td style={s.td}>
                            <span style={{ fontSize:11, fontWeight:700, color: row._sold?"#84C94C":"#ff6b6b" }}>
                              {row._sold ? "✓ Sold" : "Available"}
                            </span>
                          </td>
                        )}
                        <td style={s.td}><span style={{ color:"#4C8EC9", fontFamily:"monospace", fontWeight:700 }}>{row._parsed?.block||"—"}</span></td>
                        <td style={s.td}><span style={{ color:"#7a9ec9", fontFamily:"monospace" }}>{row._parsed?.floor||"—"}</span></td>
                        <td style={s.td}><span style={{ fontFamily:"monospace" }}>{row._parsed?.unitNo||"—"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredFinal.length === 0 && (
                <div style={{ padding:48, textAlign:"center", color:"#2a2a3a" }}>No units match the current filters.</div>
              )}
            </div>

            {/* ── Charts Section ── */}
            {enrichedRows.length > 0 && (
              <div style={{ marginTop:32 }}>
                <div style={{ fontSize:16, fontWeight:700, color:"#fff", marginBottom:16, letterSpacing:0.5 }}>
                  📈 Data Charts
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>

                  {/* ── Units by Type Bar Chart ── */}
                  {allTypes.length > 0 && (
                    <div style={S.card}>
                      <SectionHead>Units by Type — Total vs Sold vs Available</SectionHead>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart
                          data={allTypes.map((t) => ({
                            type: `Type ${t}`,
                            Total: typeStats[t]?.total || 0,
                            Sold: typeStats[t]?.sold || 0,
                            Available: (typeStats[t]?.total || 0) - (typeStats[t]?.sold || 0),
                          }))}
                          margin={{ top:8, right:16, bottom:24, left:0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false} />
                          <XAxis dataKey="type" tick={{ fill:"#999", fontSize:11 }} tickLine={false} axisLine={{ stroke:"#2a2a3a" }} />
                          <YAxis tick={{ fill:"#666", fontSize:11 }} tickLine={false} axisLine={false} />
                          <Tooltip
                            contentStyle={{ background:"#1a1a2a", border:"1px solid #2a2a40", borderRadius:8, fontSize:12 }}
                            labelStyle={{ color:"#C9A84C", fontWeight:700, marginBottom:4 }}
                            itemStyle={{ color:"#ccc" }}
                          />
                          <Legend
                            wrapperStyle={{ fontSize:12, color:"#888", paddingTop:12 }}
                            formatter={(v) => <span style={{ color:"#aaa" }}>{v}</span>}
                          />
                          <Bar dataKey="Total" fill="#C9A84C33" stroke="#C9A84C" strokeWidth={1.5} radius={[3,3,0,0]} />
                          <Bar dataKey="Sold" fill="#84C94C" radius={[3,3,0,0]} />
                          <Bar dataKey="Available" fill="#ff6b6b" opacity={0.5} radius={[3,3,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* ── Overall Sales Status Donut ── */}
                  {statusCol && salesOverall.total > 0 && (() => {
                    const soldPct = ((salesOverall.sold / salesOverall.total) * 100).toFixed(1);
                    const availPct = (100 - parseFloat(soldPct)).toFixed(1);
                    const pieData = [
                      { name: `Sold`, value: salesOverall.sold, pct: soldPct, color:"#84C94C" },
                      { name: `Available`, value: salesOverall.total - salesOverall.sold, pct: availPct, color:"#ff6b6b" },
                    ];
                    return (
                      <div style={S.card}>
                        <SectionHead>Overall Sales Status</SectionHead>
                        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                          <ResponsiveContainer width={180} height={180}>
                            <PieChart>
                              <Pie data={pieData} cx="50%" cy="50%" innerRadius={52} outerRadius={78}
                                dataKey="value" paddingAngle={3} startAngle={90} endAngle={-270}>
                                {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                              </Pie>
                              <Tooltip
                                contentStyle={{ background:"#1a1a2a", border:"1px solid #2a2a40", borderRadius:8, fontSize:12 }}
                                formatter={(v, n, p) => [`${v} units (${p.payload.pct}%)`, p.payload.name]}
                                labelFormatter={() => ""}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:10 }}>
                            <div style={{ fontSize:28, fontWeight:800, color:"#C9A84C", lineHeight:1 }}>{soldPct}%</div>
                            <div style={{ fontSize:12, color:"#555" }}>sold of {salesOverall.total} total</div>
                            {pieData.map((d) => (
                              <div key={d.name} style={{ display:"flex", alignItems:"center", gap:8 }}>
                                <div style={{ width:10, height:10, borderRadius:2, background:d.color, flexShrink:0 }} />
                                <div style={{ fontSize:12, color:"#ccc" }}>{d.name}</div>
                                <div style={{ marginLeft:"auto", fontWeight:700, fontSize:13, color:d.color }}>{d.value} <span style={{ color:"#555", fontWeight:400, fontSize:11 }}>({d.pct}%)</span></div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Bedroom Mix Donut ── */}
                  {bedroomDist.length > 0 && (() => {
                    const pieData = bedroomDist.map((b, i) => ({
                      name: `${b.label}BR`, value: b.count, pct: b.pct,
                      color: TYPE_COLOURS[i % TYPE_COLOURS.length],
                    }));
                    return (
                      <div style={S.card}>
                        <SectionHead>Bedroom Mix</SectionHead>
                        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                          <ResponsiveContainer width={180} height={180}>
                            <PieChart>
                              <Pie data={pieData} cx="50%" cy="50%" innerRadius={52} outerRadius={78}
                                dataKey="value" paddingAngle={3} startAngle={90} endAngle={-270}>
                                {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                              </Pie>
                              <Tooltip
                                contentStyle={{ background:"#1a1a2a", border:"1px solid #2a2a40", borderRadius:8, fontSize:12 }}
                                formatter={(v, n, p) => [`${v} units (${p.payload.pct}%)`, p.payload.name]}
                                labelFormatter={() => ""}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:8 }}>
                            {pieData.map((d) => (
                              <div key={d.name} style={{ display:"flex", alignItems:"center", gap:8 }}>
                                <div style={{ width:10, height:10, borderRadius:2, background:d.color, flexShrink:0 }} />
                                <div style={{ fontSize:12, color:"#ccc" }}>{d.name}</div>
                                <div style={{ marginLeft:"auto", fontWeight:700, fontSize:13, color:d.color }}>{d.value} <span style={{ color:"#555", fontWeight:400, fontSize:11 }}>({d.pct}%)</span></div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Bumi vs Non-Bumi Donut (sold units only) ── */}
                  {bumiStats && (() => {
                    const { bumiSold, nonBumiSold, totalSold, pctOfSold, allBumiSlots, bumiSoldOfSlots } = bumiStats;
                    const nonBumiPct = (100 - parseFloat(pctOfSold)).toFixed(1);
                    const pieData = [
                      { name: "Bumi Sold", value: bumiSold, pct: pctOfSold, color:"#22c55e" },
                      { name: "Non-Bumi Sold", value: nonBumiSold, pct: nonBumiPct, color:"#C94C84" },
                    ];
                    return (
                      <div style={S.card}>
                        <SectionHead>Bumi Quota (Sold Units Only)</SectionHead>
                        <div style={{ fontSize:11, color:"#555", marginBottom:12 }}>
                          Only sold units are counted — bumi status activates upon sale.
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                          <ResponsiveContainer width={180} height={180}>
                            <PieChart>
                              <Pie data={pieData} cx="50%" cy="50%" innerRadius={52} outerRadius={78}
                                dataKey="value" paddingAngle={3} startAngle={90} endAngle={-270}>
                                {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                              </Pie>
                              <Tooltip
                                contentStyle={{ background:"#1a1a2a", border:"1px solid #2a2a40", borderRadius:8, fontSize:12 }}
                                formatter={(v, n, p) => [`${v} units (${p.payload.pct}%)`, p.payload.name]}
                                labelFormatter={() => ""}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:8 }}>
                            <div style={{ fontSize:26, fontWeight:800, color:"#22c55e", lineHeight:1 }}>{pctOfSold}%</div>
                            <div style={{ fontSize:12, color:"#555" }}>of {totalSold} sold units are bumi</div>
                            <div style={{ fontSize:11, color:"#444", marginBottom:4 }}>
                              Bumi quota filled: <strong style={{ color:"#22c55e" }}>{bumiSold}</strong> / {allBumiSlots} slots ({bumiSoldOfSlots}%)
                            </div>
                            {pieData.map((d) => (
                              <div key={d.name} style={{ display:"flex", alignItems:"center", gap:8 }}>
                                <div style={{ width:10, height:10, borderRadius:2, background:d.color, flexShrink:0 }} />
                                <div style={{ fontSize:12, color:"#ccc" }}>{d.name}</div>
                                <div style={{ marginLeft:"auto", fontWeight:700, fontSize:13, color:d.color }}>
                                  {d.value} <span style={{ color:"#555", fontWeight:400, fontSize:11 }}>({d.pct}%)</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Sales by Block Stacked Bar ── */}
                  {statusCol && Object.keys(salesByBlock).length > 0 && (
                    <div style={{ ...S.card, gridColumn: Object.keys(salesByBlock).length > 1 ? "span 2" : "auto" }}>
                      <SectionHead>Sales Rate by Block</SectionHead>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart
                          data={Object.entries(salesByBlock).map(([blk, { sold, total }]) => ({
                            block: `Block ${blk}`,
                            Sold: sold,
                            Available: total - sold,
                            total,
                            pct: total > 0 ? parseFloat(((sold/total)*100).toFixed(1)) : 0,
                          }))}
                          margin={{ top:8, right:16, bottom:20, left:0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false} />
                          <XAxis dataKey="block" tick={{ fill:"#999", fontSize:11 }} tickLine={false} axisLine={{ stroke:"#2a2a3a" }} />
                          <YAxis tick={{ fill:"#666", fontSize:11 }} tickLine={false} axisLine={false} />
                          <Tooltip
                            contentStyle={{ background:"#1a1a2a", border:"1px solid #2a2a40", borderRadius:8, fontSize:12 }}
                            labelStyle={{ color:"#C9A84C", fontWeight:700, marginBottom:4 }}
                            itemStyle={{ color:"#ccc" }}
                            formatter={(v, n, p) => [`${v} units`, n]}
                          />
                          <Legend
                            wrapperStyle={{ fontSize:12, paddingTop:8 }}
                            formatter={(v) => <span style={{ color:"#aaa" }}>{v}</span>}
                          />
                          <Bar dataKey="Sold" fill="#84C94C" radius={[0,0,0,0]} stackId="a" />
                          <Bar dataKey="Available" fill="#ff6b6b" opacity={0.55} radius={[3,3,0,0]} stackId="a" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                </div>
              </div>
            )}

            {/* ── Sales Chart ── */}
            {enrichedRows.length > 0 && (
              <SalesChart
                enrichedRows={enrichedRows}
                spjbCol={spjbCol}
                priceCol={priceCol}
                sqftMap={sqftMap}
                bedroomMap={bedroomMap}
                allTypes={allTypes}
                typeColor={typeColor}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
// ─── Shared inline styles for AddBlockPanel ──────────────────────────────────
const IS = {
  input: { width:"100%", background:"#0c0c18", border:"1px solid #2a2a40", color:"#ddd",
    borderRadius:6, padding:"8px 12px", fontSize:13, outline:"none", boxSizing:"border-box" },
  textarea: { width:"100%", background:"#0c0c18", border:"1px solid #1e1e30", color:"#ddd",
    borderRadius:8, fontSize:13, padding:12, fontFamily:"monospace", resize:"vertical",
    outline:"none", boxSizing:"border-box", display:"block" },
  fileBtn: { display:"inline-block", padding:"8px 18px", background:"#1a1a2a",
    border:"1px dashed #3a3a55", borderRadius:8, cursor:"pointer", color:"#aaa", fontSize:13, marginBottom:8 },
  btn: { background:"#C9A84C", color:"#0c0c18", border:"none", borderRadius:8,
    padding:"10px 24px", fontSize:14, fontWeight:700, cursor:"pointer" },
  ghostBtn: { background:"transparent", border:"1px solid #2a2a40", color:"#888",
    borderRadius:8, padding:"8px 16px", fontSize:13, cursor:"pointer" },
};

// ─── Main styles ─────────────────────────────────────────────────────────────
const S = {
  root: { minHeight:"100vh", background:"#0c0c18", color:"#e0e0f0", fontFamily:"'DM Sans','Segoe UI',sans-serif", display:"flex", flexDirection:"column" },
  header: { display:"flex", alignItems:"center", gap:14, padding:"14px 32px",
    borderBottom:"1px solid #1a1a2e", background:"#0e0e1c", position:"sticky", top:0, zIndex:100, flexShrink:0 },
  brand: { fontSize:18, fontWeight:800, letterSpacing:1, color:"#fff" },
  tagline: { fontSize:10, color:"#555", letterSpacing:1.5, textTransform:"uppercase" },
  navSteps: { display:"flex", alignItems:"center", marginLeft:"auto" },body: { padding:"24px 32px", flex:1, width:"100%", boxSizing:"border-box", display:"flex", flexDirection:"column" },
  card: { background:"#13131f", border:"1px solid #1e1e30", borderRadius:16, padding:28, marginBottom:20 },
  cardTitle: { fontSize:18, fontWeight:700, color:"#fff", marginBottom:8 },
  cardSub: { fontSize:13, color:"#666", marginBottom:14, lineHeight:1.6 },
  code: { background:"#1e1e30", color:"#C9A84C", padding:"2px 6px", borderRadius:4, fontSize:11, fontFamily:"monospace" },
  fileBtn: { display:"inline-block", padding:"10px 22px", background:"#1a1a2a",
    border:"1px dashed #3a3a55", borderRadius:8, cursor:"pointer", color:"#aaa", fontSize:14, marginBottom:4 },
  divider: { textAlign:"center", borderTop:"1px solid #1e1e30", margin:"14px 0", lineHeight:0 },
  dividerTxt: { background:"#13131f", padding:"0 12px", color:"#444", fontSize:12, letterSpacing:1 },
  textarea: { width:"100%", background:"#0c0c18", border:"1px solid #1e1e30", borderRadius:8,
    color:"#ddd", fontSize:13, padding:14, fontFamily:"monospace", resize:"vertical",
    outline:"none", boxSizing:"border-box" },
  error: { color:"#ff6b6b", fontSize:13, marginTop:8 },
  btn: { marginTop:14, background:"#C9A84C", color:"#0c0c18", border:"none",
    borderRadius:8, padding:"12px 28px", fontSize:14, fontWeight:700, cursor:"pointer" },
  ghostBtn: { background:"transparent", border:"1px solid #2a2a40", color:"#888",
    borderRadius:8, padding:"8px 16px", fontSize:13, cursor:"pointer" },
  label: { fontSize:11, color:"#666", marginBottom:5, letterSpacing:0.5, textTransform:"uppercase", display:"block" },
  select: { width:"100%", background:"#0c0c18", border:"1px solid #2a2a40",
    color:"#ddd", borderRadius:6, padding:"8px 10px", fontSize:13, outline:"none" },
  mapRow: { display:"flex", alignItems:"center", gap:10, padding:"6px 10px",
    background:"#0c0c18", borderRadius:6, border:"1px solid #1a1a2e" },
  unitTag: { fontFamily:"monospace", fontSize:12, color:"#C9A84C", minWidth:72 },
  typeInput: { marginLeft:"auto", width:90, background:"#13131f", border:"1px solid #2a2a40",
    color:"#fff", borderRadius:4, padding:"4px 8px", fontSize:13, fontFamily:"monospace", outline:"none" },
  table: { width:"100%", borderCollapse:"collapse", fontSize:13 },
  th: { textAlign:"left", padding:"10px 14px", background:"#0e0e1c", color:"#555",
    fontWeight:600, fontSize:11, letterSpacing:0.5, borderBottom:"1px solid #1a1a2e",
    whiteSpace:"nowrap", textTransform:"uppercase" },
  td: { padding:"8px 14px", borderBottom:"1px solid #0f0f1e", color:"#bbb", whiteSpace:"nowrap" },
  trEven: { background:"#0f0f1d" },
  statsBar: { display:"flex", gap:10, flexWrap:"wrap", marginBottom:20 },
  statChip: { display:"flex", flexDirection:"column", alignItems:"center", padding:"10px 14px",
    background:"#13131f", border:"2px solid", borderRadius:12, cursor:"pointer",
    minWidth:68, transition:"border-color 0.2s, background 0.2s" },
  statNum: { fontSize:19, fontWeight:800, color:"#C9A84C", lineHeight:1 },
  statLbl: { fontSize:10, color:"#555", marginTop:3, letterSpacing:0.5 },
  toolbar: { display:"flex", gap:10, alignItems:"center", marginBottom:10 },
  search: { background:"#13131f", border:"1px solid #1e1e30", color:"#ddd",
    borderRadius:8, padding:"9px 14px", fontSize:13, outline:"none", width:220 },
};
