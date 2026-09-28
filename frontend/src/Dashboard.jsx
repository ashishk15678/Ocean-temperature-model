/**
 * Dashboard  /dashboard
 *
 * Data flow
 *   1. GET /health                 — live, not cached
 *   2. GET /api/v1/model-info      — cached forever (static)
 *   3. POST /api/v1/predict ×N     — SEQUENTIAL (one at a time) to keep
 *                                    the backend from dropping under load
 *
 * Scrolling
 *   Sets body.dashboard-page on mount → overrides the global overflow:hidden
 *   from index.css, restores on unmount.
 *
 * Performance
 *   Module-level Map cache — results survive re-renders and page revisits
 *   within the same session.  All expensive list transforms are useMemo'd.
 *   All leaf components are React.memo'd.
 */
import React, {
  useState, useEffect, useCallback, useMemo, memo,
} from 'react';
import { fetchTemperatureProfile, fetchHealth, fetchModelInfo } from './ocean-api';
import { temperatureToRGB, makeNormalizer } from './color-scale';
import { CONFIG } from './config';

// ─── Module-level cache ───────────────────────────────────────────────────────
const _cache = new Map();
async function cached(key, fetcher) {
  if (_cache.has(key)) return _cache.get(key);
  const p = fetcher();           // store the Promise so concurrent callers share it
  _cache.set(key, p);
  try { return await p; } catch (e) { _cache.delete(key); throw e; }
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:      '#07080d',
  surf:    '#0d0f18',
  raised:  '#12141f',
  border:  '#1a1d2e',
  bhi:     '#252840',
  text:    '#dde1f0',
  muted:   '#5a6280',
  dim:     '#30364a',
  blue:    '#3b82f6',
  cyan:    '#06b6d4',
  green:   '#10b981',
  amber:   '#f59e0b',
  red:     '#ef4444',
  violet:  '#8b5cf6',
  mono: "'JetBrains Mono','Fira Code',ui-monospace,monospace",
  sans: "'Inter','system-ui',sans-serif",
};

// SVG patterns (no gradients)
const DOT_BG  = `url("data:image/svg+xml,%3Csvg width='24' height='24' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='1' cy='1' r='1' fill='%231a1d2e'/%3E%3C/svg%3E")`;
const GRID_BG = `url("data:image/svg+xml,%3Csvg width='32' height='32' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M32 0H0v32' fill='none' stroke='%231a1d2e' stroke-width='0.5'/%3E%3C/svg%3E")`;

// ─── Primitives ───────────────────────────────────────────────────────────────

const Divider = () => <div style={{ height:1, background:C.border, margin:'10px 0' }} />;

const Badge = memo(({ color=C.blue, children, dot }) => (
  <span style={{
    display:'inline-flex', alignItems:'center', gap:5,
    padding:'2px 8px', borderRadius:4,
    border:`1px solid ${color}40`, background:`${color}10`,
    color, fontSize:10, fontWeight:700, fontFamily:C.mono, letterSpacing:'0.05em',
    whiteSpace:'nowrap',
  }}>
    {dot && <span style={{ width:6, height:6, borderRadius:'50%', background:color, flexShrink:0 }} />}
    {children}
  </span>
));

const PulseDot = memo(({ color }) => (
  <span style={{ position:'relative', display:'inline-flex', width:8, height:8, flexShrink:0 }}>
    <span style={{
      position:'absolute', inset:0, borderRadius:'50%',
      background:color, opacity:0.4, animation:'ping 1.5s ease-out infinite',
    }} />
    <span style={{
      width:8, height:8, borderRadius:'50%', background:color,
      boxShadow:`0 0 6px ${color}`,
    }} />
  </span>
));

const KV = memo(({ k, v, vc, mono=true }) => (
  <div style={{
    display:'flex', justifyContent:'space-between', alignItems:'baseline',
    padding:'4px 0', borderBottom:`1px solid ${C.border}`,
  }}>
    <span style={{ color:C.muted, fontSize:12, fontFamily:C.sans, flexShrink:0 }}>{k}</span>
    <span style={{
      color:vc??C.text, fontSize:12, fontWeight:600,
      fontFamily:mono?C.mono:C.sans, textAlign:'right', marginLeft:12,
    }}>{v}</span>
  </div>
));

const Spin = () => (
  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'16px 0', color:C.muted, fontSize:12 }}>
    <span style={{
      width:13, height:13, borderRadius:'50%',
      border:`2px solid ${C.border}`, borderTop:`2px solid ${C.blue}`,
      animation:'spin .7s linear infinite', flexShrink:0,
    }}/>Loading…
  </div>
);

const Err = ({ msg }) => (
  <div style={{
    padding:'9px 12px', borderRadius:6, background:'#160707',
    border:`1px solid ${C.red}30`, color:C.red, fontSize:11, fontFamily:C.mono,
    wordBreak:'break-word',
  }}>{msg}</div>
);

// Card shell — accent bar on top, optional span
const Card = memo(({ title, badge, accent, children, col, style:sx }) => (
  <section style={{
    background:C.surf, border:`1px solid ${accent?accent+'28':C.border}`,
    borderRadius:10, padding:'18px 20px',
    gridColumn: col ? `span ${col}` : undefined,
    position:'relative', overflow:'hidden', ...sx,
  }}>
    {accent && (
      <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:accent }} />
    )}
    {(title||badge) && (
      <div style={{
        display:'flex', alignItems:'center', gap:8,
        marginBottom:13, marginTop:accent?4:0,
      }}>
        {title && (
          <h2 style={{
            margin:0, fontSize:10, fontWeight:700, letterSpacing:'0.1em',
            textTransform:'uppercase', color:C.muted, fontFamily:C.sans, flex:1,
          }}>{title}</h2>
        )}
        {badge}
      </div>
    )}
    {children}
  </section>
));

// Big number tile
const Tile = memo(({ label, value, unit, color, sub }) => (
  <div style={{
    background:C.raised, border:`1px solid ${C.border}`,
    borderRadius:7, padding:'12px 14px',
  }}>
    <div style={{ fontSize:10, color:C.muted, fontFamily:C.sans, marginBottom:5, fontWeight:500 }}>
      {label}
    </div>
    <div style={{ display:'flex', alignItems:'baseline', gap:3 }}>
      <span style={{ fontSize:22, fontWeight:700, color:color??C.text, fontFamily:C.mono, lineHeight:1 }}>
        {value}
      </span>
      {unit && <span style={{ fontSize:11, color:C.muted, fontFamily:C.mono }}>{unit}</span>}
    </div>
    {sub && <div style={{ fontSize:10, color:C.dim, marginTop:3 }}>{sub}</div>}
  </div>
));

// ─── Horizontal bar chart ─────────────────────────────────────────────────────
const TempBars = memo(({ depths, temps }) => {
  const norm = useMemo(() => makeNormalizer(temps), [temps]);
  const min  = useMemo(() => Math.min(...temps), [temps]);
  const max  = useMemo(() => Math.max(...temps), [temps]);
  const span = max - min || 1;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:C.dim, marginBottom:4, fontFamily:C.mono }}>
        <span>DEPTH</span><span>TEMPERATURE °C</span>
      </div>
      {depths.map((d,i) => {
        const t = temps[i];
        const [r,g,b] = temperatureToRGB(norm(t));
        const col = `rgb(${r},${g},${b})`;
        const pct = ((t-min)/span)*100;
        return (
          <div key={d} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ width:40, textAlign:'right', fontSize:9, color:C.muted, fontFamily:C.mono, flexShrink:0 }}>{d}m</span>
            <div style={{ flex:1, height:14, borderRadius:2, background:C.raised, overflow:'hidden' }}>
              <div style={{
                width:`${Math.max(1,pct)}%`, height:'100%',
                background:col, transition:'width .5s ease',
              }}/>
            </div>
            <span style={{ width:48, fontSize:9, fontFamily:C.mono, fontWeight:700, color:col, textAlign:'right', flexShrink:0 }}>
              {t.toFixed(2)}
            </span>
          </div>
        );
      })}
    </div>
  );
});

// ─── SVG sparkline (depth vs temp) ───────────────────────────────────────────
const Sparkline = memo(({ temps, depths }) => {
  const W=240, H=72;
  const min=Math.min(...temps), max=Math.max(...temps), span=max-min||1;
  const norm = useMemo(() => makeNormalizer(temps), [temps]);
  const pts  = useMemo(() =>
    temps.map((t,i)=>
      `${((i/(temps.length-1))*W).toFixed(1)},${(H-((t-min)/span)*(H-8)-4).toFixed(1)}`
    ).join(' '), [temps, min, span, W, H]);
  const [sr,sg,sb] = temperatureToRGB(norm(temps[0]));
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:C.muted, fontFamily:C.mono, marginBottom:2 }}>
        <span>Surface {temps[0]?.toFixed(1)}°C</span>
        <span>Deep {temps[temps.length-1]?.toFixed(1)}°C</span>
      </div>
      <svg width={W} height={H} style={{ display:'block', overflow:'visible' }}>
        <polyline points={pts} fill="none"
          stroke={`rgb(${sr},${sg},${sb})`} strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round"/>
        {temps.map((t,i)=>{
          const x=(i/(temps.length-1))*W;
          const y=H-((t-min)/span)*(H-8)-4;
          const [r,g,b]=temperatureToRGB(norm(t));
          return <circle key={i} cx={x} cy={y} r={2}
            fill={`rgb(${r},${g},${b})`} stroke={C.surf} strokeWidth="1"/>;
        })}
      </svg>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, color:C.dim, fontFamily:C.mono, marginTop:1 }}>
        {[0, Math.floor(depths.length/2), depths.length-1].map(i=>(
          <span key={i}>{depths[i]}m</span>
        ))}
      </div>
    </div>
  );
});

// ─── Thermocline colour strip ─────────────────────────────────────────────────
const ThermStrip = memo(({ depths, temps, thermoclineDepth }) => {
  const norm = useMemo(() => makeNormalizer(temps), [temps]);
  return (
    <div style={{ display:'flex', gap:2, height:40, marginBottom:16 }}>
      {temps.map((t,i) => {
        const [r,g,b]=temperatureToRGB(norm(t));
        const isTc = depths[i]===thermoclineDepth;
        return (
          <div key={depths[i]} style={{ flex:1, position:'relative' }}>
            <div style={{
              width:'100%', height:'100%',
              background:`rgb(${r},${g},${b})`, borderRadius:2,
              outline:isTc?'2px solid #fff':'none', outlineOffset:isTc?1:0,
            }}/>
            {isTc && (
              <div style={{
                position:'absolute', bottom:-14, left:'50%',
                transform:'translateX(-50%)', fontSize:7, color:'#fff',
                fontFamily:C.mono, whiteSpace:'nowrap',
              }}>▲{depths[i]}m</div>
            )}
          </div>
        );
      })}
    </div>
  );
});

// ─── Comparison table ─────────────────────────────────────────────────────────
const CmpTable = memo(({ profiles }) => {
  const keys   = useMemo(() => Object.keys(profiles), [profiles]);
  if (keys.length < 2) return null;
  const depths = profiles[keys[0]]?.depths_m ?? [];
  const norms  = useMemo(
    () => Object.fromEntries(keys.map(k=>[k, makeNormalizer(profiles[k]?.temperature_c??[])])),
    [profiles, keys],
  );
  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:10, fontFamily:C.mono }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${C.border}` }}>
            <th style={{ padding:'6px 10px', textAlign:'left',  color:C.muted, fontWeight:700, letterSpacing:'0.06em' }}>DEPTH</th>
            {keys.map(k=>(
              <th key={k} style={{ padding:'6px 10px', textAlign:'right', color:C.text, fontWeight:700, letterSpacing:'0.06em' }}>
                {k.toUpperCase().replace(' ','_')}
              </th>
            ))}
            <th style={{ padding:'6px 10px', textAlign:'right', color:C.muted, fontWeight:700 }}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {depths.map((d,i)=>{
            const vals = keys.map(k=>profiles[k]?.temperature_c?.[i]??null);
            const delta = vals[0]!=null&&vals[1]!=null ? vals[0]-vals[1] : null;
            return (
              <tr key={d} style={{ background:i%2===0?C.raised:'transparent' }}>
                <td style={{ padding:'4px 10px', color:C.muted }}>{d} m</td>
                {vals.map((v,ri)=>{
                  if(v==null) return <td key={ri} style={{ padding:'4px 10px', textAlign:'right' }}>—</td>;
                  const [r,g,b]=temperatureToRGB(norms[keys[ri]](v));
                  return (
                    <td key={ri} style={{ padding:'4px 10px', textAlign:'right',
                      color:`rgb(${r},${g},${b})`, fontWeight:700 }}>
                      {v.toFixed(3)}
                    </td>
                  );
                })}
                <td style={{ padding:'4px 10px', textAlign:'right', fontWeight:600,
                  color:delta==null?C.dim:delta>0.5?C.red:delta<-0.5?C.blue:C.muted }}>
                  {delta==null?'—':`${delta>0?'+':''}${delta.toFixed(3)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

// ─── Channel pills ─────────────────────────────────────────────────────────────
const ChanList = memo(({ vars, masks }) => (
  <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
    {vars?.map((v,i)=>(
      <div key={v} style={{
        display:'flex', alignItems:'center', gap:4,
        background:C.raised, border:`1px solid ${C.border}`,
        borderRadius:4, padding:'3px 7px',
      }}>
        <span style={{ fontSize:8, color:C.dim, fontFamily:C.mono, fontWeight:700 }}>{String(i).padStart(2,'0')}</span>
        <span style={{ fontSize:10, fontFamily:C.mono, color:C.cyan }}>{v}</span>
      </div>
    ))}
    {masks?.map((v,i)=>(
      <div key={v} style={{
        display:'flex', alignItems:'center', gap:4,
        background:C.raised, border:`1px solid ${C.border}`,
        borderRadius:4, padding:'3px 7px',
      }}>
        <span style={{ fontSize:8, color:C.dim, fontFamily:C.mono, fontWeight:700 }}>{String((vars?.length??0)+i).padStart(2,'0')}</span>
        <span style={{ fontSize:10, fontFamily:C.mono, color:C.violet }}>{v}</span>
      </div>
    ))}
  </div>
));

// ─── Grid mini-map ────────────────────────────────────────────────────────────
const GridMap = memo(({ info }) => {
  if(!info) return null;
  const { lat_start, lat_end, lon_start, lon_end } = info.grid;
  const regions = info.focus_regions??[];
  const latPct = l => 100-(l-lat_start)/(lat_end-lat_start)*100;
  const lonPct = l => (l-lon_start)/(lon_end-lon_start)*100;
  return (
    <div style={{
      position:'relative', height:120,
      background:C.raised, backgroundImage:GRID_BG,
      border:`1px solid ${C.border}`, borderRadius:6, overflow:'hidden',
    }}>
      <div style={{ position:'absolute', inset:6, border:`1px solid ${C.blue}30`, borderRadius:3 }}/>
      {regions.map(r=>(
        <div key={r.name} style={{
          position:'absolute',
          left:`${6+lonPct(r.lon)*0.88}%`,
          top:`${6+latPct(r.lat)*0.88}%`,
          transform:'translate(-50%,-50%)',
        }}>
          <div style={{ width:6, height:6, borderRadius:'50%', background:C.cyan, boxShadow:`0 0 6px ${C.cyan}` }}/>
          <div style={{
            position:'absolute', top:8, left:'50%', transform:'translateX(-50%)',
            fontSize:8, color:C.text, fontFamily:C.sans, fontWeight:600,
            whiteSpace:'nowrap', background:C.surf, padding:'1px 3px', borderRadius:2,
          }}>{r.name}</div>
        </div>
      ))}
      <span style={{ position:'absolute', bottom:2, left:6,  fontSize:8, color:C.dim, fontFamily:C.mono }}>{lon_start}°E</span>
      <span style={{ position:'absolute', bottom:2, right:6, fontSize:8, color:C.dim, fontFamily:C.mono }}>{lon_end}°E</span>
      <span style={{ position:'absolute', top:6, left:2,     fontSize:8, color:C.dim, fontFamily:C.mono, writingMode:'vertical-rl' }}>{lat_end}°N</span>
    </div>
  );
});

// ─── Depth chips with thermal colour ─────────────────────────────────────────
const DepthChips = memo(({ depths }) => (
  <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
    {depths.map((d,i)=>{
      const nt = i/(depths.length-1);
      const [r,g,b]=temperatureToRGB(1-nt);
      return (
        <span key={d} style={{
          padding:'2px 7px', borderRadius:3,
          background:C.raised, border:`1px solid rgb(${r},${g},${b})38`,
          color:`rgb(${r},${g},${b})`, fontSize:10, fontFamily:C.mono, fontWeight:600,
        }}>{d}m</span>
      );
    })}
  </div>
));

// ─── Normalisation stats table ────────────────────────────────────────────────
const NormTable = memo(({ vars }) => {
  if(!vars?.length) return null;
  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:10, fontFamily:C.mono }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${C.border}` }}>
            {['Variable','Channel','Type'].map(h=>(
              <th key={h} style={{ padding:'5px 8px', textAlign:'left', color:C.muted, fontWeight:700, letterSpacing:'0.06em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vars.map((v,i)=>(
            <tr key={v} style={{ background:i%2===0?C.raised:'transparent' }}>
              <td style={{ padding:'3px 8px', color:C.cyan }}>{v}</td>
              <td style={{ padding:'3px 8px', color:C.dim }}>ch {String(i).padStart(2,'0')}</td>
              <td style={{ padding:'3px 8px', color:C.violet }}>physical</td>
            </tr>
          ))}
          {vars.map((v,i)=>(
            <tr key={v+'_mask'} style={{ background:(vars.length+i)%2===0?C.raised:'transparent' }}>
              <td style={{ padding:'3px 8px', color:C.violet }}>{v}_mask</td>
              <td style={{ padding:'3px 8px', color:C.dim }}>ch {String(vars.length+i).padStart(2,'0')}</td>
              <td style={{ padding:'3px 8px', color:C.amber }}>mask</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

// ─── Focus regions ────────────────────────────────────────────────────────────
const FOCUS = [CONFIG.ARABIAN_SEA, CONFIG.BAY_OF_BENGAL];
const ACCENT = [C.cyan, C.blue];

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  // ── body class for scrolling ─────────────────────────────────────────────
  useEffect(() => {
    document.body.classList.add('dashboard-page');
    return () => document.body.classList.remove('dashboard-page');
  }, []);

  // ── state ─────────────────────────────────────────────────────────────────
  const [health,    setHealth]    = useState(null);
  const [hErr,      setHErr]      = useState(null);
  const [hLoad,     setHLoad]     = useState(true);

  const [info,      setInfo]      = useState(null);
  const [iErr,      setIErr]      = useState(null);
  const [iLoad,     setILoad]     = useState(true);

  // Sequential region fetches: status per region
  const initR = () => FOCUS.map(r=>({ label:r.label, data:null, loading:true, error:null }));
  const [regions, setRegions] = useState(initR);

  // ── fetch — sequential regions to protect backend ────────────────────────
  const fetchAll = useCallback(async () => {
    // 1. health (always live)
    setHLoad(true); setHErr(null);
    fetchHealth()
      .then(d=>{ setHealth(d); setHErr(null); })
      .catch(e=>setHErr(e.message))
      .finally(()=>setHLoad(false));

    // 2. model info (cached)
    setILoad(true); setIErr(null);
    cached('model-info', fetchModelInfo)
      .then(d=>{ setInfo(d); setIErr(null); })
      .catch(e=>setIErr(e.message))
      .finally(()=>setILoad(false));

    // 3. region profiles — SEQUENTIAL, one at a time
    setRegions(initR());
    for (const r of FOCUS) {
      const key = `profile:${r.label}:${CONFIG.DEFAULT_DATE}`;
      try {
        const d = await cached(key, ()=>fetchTemperatureProfile({ latitude:r.lat, longitude:r.lon }));
        setRegions(prev => prev.map(x => x.label===r.label ? { ...x, data:d, loading:false } : x));
      } catch(e) {
        setRegions(prev => prev.map(x => x.label===r.label ? { ...x, error:e.message, loading:false } : x));
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── derived ───────────────────────────────────────────────────────────────
  const profileMap = useMemo(
    ()=>Object.fromEntries(regions.filter(r=>r.data).map(r=>[r.label,r.data])),
    [regions],
  );
  const stats = useMemo(()=>{
    const ps=Object.values(profileMap);
    if(!ps.length) return null;
    const all=ps.flatMap(p=>p.temperature_c);
    const max=Math.max(...all), min=Math.min(...all);
    const mean=all.reduce((a,b)=>a+b,0)/all.length;
    const std=Math.sqrt(all.reduce((a,b)=>a+(b-mean)**2,0)/all.length);
    return { max, min, mean, std, n:all.length };
  }, [profileMap]);

  const bothLoaded = FOCUS.every(r=>profileMap[r.label]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap');
        *{box-sizing:border-box}
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes ping { 0%{transform:scale(1);opacity:.8} 70%,100%{transform:scale(2.2);opacity:0} }
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:${C.surf}}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
      `}</style>

      <div style={{
        minHeight:'100vh', background:C.bg, backgroundImage:DOT_BG,
        fontFamily:C.sans, color:C.text, padding:'20px 24px 48px',
      }}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <header style={{
          display:'flex', justifyContent:'space-between', alignItems:'center',
          marginBottom:24, paddingBottom:18, borderBottom:`1px solid ${C.border}`,
          flexWrap:'wrap', gap:12,
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:14 }}>
            <div style={{
              width:34, height:34, borderRadius:7,
              background:C.surf, border:`1px solid ${C.border}`,
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:17,
            }}>🌊</div>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <h1 style={{ margin:0, fontSize:17, fontWeight:700, letterSpacing:'-0.02em' }}>
                  OceanEmbed Dashboard
                </h1>
                <Badge color={C.blue}>v1.0.0</Badge>
                {health?.model_loaded && <Badge color={C.green} dot>LIVE</Badge>}
                {!health?.model_loaded && !hLoad && <Badge color={C.amber} dot>NO MODEL</Badge>}
              </div>
              <p style={{ margin:'2px 0 0', fontSize:11, color:C.muted }}>
                Indian Ocean · Arabian Sea · Bay of Bengal · {CONFIG.DEFAULT_DATE}
                {_cache.size>0 && <span style={{ marginLeft:8, color:C.dim }}>({_cache.size} cached)</span>}
              </p>
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <a href="/" style={{
              display:'inline-flex', alignItems:'center', gap:4,
              padding:'6px 13px', borderRadius:6,
              border:`1px solid ${C.border}`, background:C.surf,
              color:C.muted, fontSize:11, textDecoration:'none', fontWeight:500,
            }}>← Globe</a>
            <button onClick={fetchAll} style={{
              display:'inline-flex', alignItems:'center', gap:5,
              padding:'6px 13px', borderRadius:6,
              border:`1px solid ${C.blue}40`, background:`${C.blue}10`,
              color:C.blue, fontSize:11, cursor:'pointer', fontWeight:600,
            }}>↻ Refresh</button>
          </div>
        </header>

        {/* ── Grid ────────────────────────────────────────────────────── */}
        <div style={{
          display:'grid',
          gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',
          gap:12, alignItems:'start',
        }}>

          {/* 1 — Backend health */}
          <Card title="Backend Health"
            accent={hLoad?C.amber:health?.status==='ok'?C.green:C.red}
            badge={!hLoad&&(health?.status==='ok'
              ? <span style={{display:'flex',alignItems:'center',gap:6}}><PulseDot color={C.green}/><Badge color={C.green}>OK 200</Badge></span>
              : hErr ? <Badge color={C.red}>UNREACHABLE</Badge> : null)}>
            {hLoad?<Spin/>:hErr?<Err msg={hErr}/>:(
              <>
                <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:10}}>
                  <Badge color={health?.model_loaded?C.green:C.red}>
                    {health?.model_loaded?'Model Loaded':'Model Not Loaded'}
                  </Badge>
                  <Badge color={C.cyan}>{health?.device??'—'}</Badge>
                </div>
                <KV k="Status"   v={health?.status}   vc={C.green}/>
                <KV k="Device"   v={health?.device}   vc={C.cyan}/>
                <KV k="API"      v={CONFIG.API_ENDPOINT}/>
                <KV k="Mode"     v={CONFIG.USE_MOCK_DATA?'Mock':'Live'} vc={CONFIG.USE_MOCK_DATA?C.amber:C.green}/>
                <KV k="Health EP" v={CONFIG.HEALTH_ENDPOINT}/>
              </>
            )}
          </Card>

          {/* 2 — Model architecture */}
          <Card title="Architecture" accent={C.violet} badge={<Badge color={C.violet}>OceanEmbedNet</Badge>}>
            {iLoad?<Spin/>:iErr?<Err msg={iErr}/>:(
              <>
                <KV k="Name"          v="OceanEmbedNet" mono={false}/>
                <KV k="Checkpoint"    v={info?.model?.checkpoint??'—'}/>
                <KV k="In channels"   v={`${info?.model?.in_channels??14}`}/>
                <KV k="Embedding dim" v={`${info?.model?.embedding_dim??64}`}/>
                <KV k="Out channels"  v={`${info?.model?.out_channels??14}`}/>
                <KV k="Sequence len"  v={`${info?.model?.sequence_length??3} days`}/>
                <KV k="Patch"         v={`${info?.model?.patch_size??32}×${info?.model?.patch_size??32} stride ${info?.model?.patch_stride??32}`}/>
                <KV k="Device"        v={info?.model?.device??'—'} vc={C.cyan}/>
                <Divider/>
                <p style={{margin:0,fontSize:10,color:C.muted,lineHeight:1.6}}>
                  Spatial patches extracted from Indian Ocean grid, processed with a
                  temporal sequence of {info?.model?.sequence_length??3} days (t‑2, t‑1, t),
                  reconstructed via average-overlap to full {info?.grid?.n_lat??100}×{info?.grid?.n_lon??240} grid.
                </p>
              </>
            )}
          </Card>

          {/* 3 — Grid */}
          <Card title="Model Grid" accent={C.blue}>
            {iLoad?<Spin/>:iErr?<Err msg={iErr}/>:(
              <>
                <GridMap info={info}/>
                <div style={{marginTop:10}}>
                  <KV k="Lat"        v={`${info.grid.lat_start}° → ${info.grid.lat_end}°N`}/>
                  <KV k="Lon"        v={`${info.grid.lon_start}° → ${info.grid.lon_end}°E`}/>
                  <KV k="Resolution" v="0.25°"/>
                  <KV k="Grid size"  v={`${info.grid.n_lat} × ${info.grid.n_lon}`}/>
                  <KV k="Total cells" v={(info.grid.total_cells??24000).toLocaleString()}/>
                </div>
              </>
            )}
          </Card>

          {/* 4 — Data availability */}
          <Card title="Data Availability" accent={C.amber}>
            {iLoad?<Spin/>:(
              <>
                <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:10}}>
                  {(info?.available_years??CONFIG.AVAILABLE_YEARS).map(y=>{
                    const active = y===parseInt(CONFIG.DEFAULT_DATE.slice(0,4));
                    return (
                      <div key={y} style={{
                        padding:'3px 8px', borderRadius:4,
                        background:active?`${C.amber}15`:C.raised,
                        border:`1px solid ${active?C.amber+'50':C.border}`,
                        fontSize:10, fontFamily:C.mono, fontWeight:700,
                        color:active?C.amber:C.muted,
                      }}>{y}</div>
                    );
                  })}
                </div>
                <KV k="Active date"   v={CONFIG.DEFAULT_DATE} vc={C.amber}/>
                <KV k="Years"         v={`${(info?.available_years??CONFIG.AVAILABLE_YEARS).length}`}/>
                <KV k="Lookback"      v="3 days (SL=3)"/>
                <KV k="Year span"     v="2000 – 2005"/>
                <Divider/>
                <p style={{margin:0,fontSize:10,color:C.muted}}>
                  Each prediction requires 3 consecutive daily surface files.
                  Dates within the first 2 days of a year need the previous year's data.
                </p>
              </>
            )}
          </Card>

          {/* 5 — Input channels (wide) */}
          <Card title="Input Channels — 14 total" accent={C.cyan} col={2}>
            {iLoad?<Spin/>:iErr?<Err msg={iErr}/>:(
              <>
                <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                  <Badge color={C.cyan}>7 Physical variables</Badge>
                  <Badge color={C.violet}>7 Validity masks</Badge>
                </div>
                <ChanList vars={info?.surface_variables} masks={info?.mask_variables}/>
                <Divider/>
                <NormTable vars={info?.surface_variables}/>
                <Divider/>
                <p style={{margin:0,fontSize:10,color:C.muted,lineHeight:1.6}}>
                  Channels 0–6: raw physical values normalised with per-variable training
                  mean/std.  Channels 7–13: binary validity masks (1 = finite value,
                  0 = land / NaN).  NaN cells are filled with 0 after normalisation.
                </p>
              </>
            )}
          </Card>

          {/* 6 — Target depths */}
          <Card title="Target Depths" accent={C.blue}>
            {iLoad?<Spin/>:(
              <>
                <DepthChips depths={info?.target_depths_m??CONFIG.TARGET_DEPTHS}/>
                <Divider/>
                <KV k="Total depths" v={`${info?.n_target_depths??14}`}/>
                <KV k="Shallowest"   v="5 m"/>
                <KV k="Deepest"      v="1000 m"/>
                <KV k="Coverage"     v="Surface → deep ocean"/>
                <Divider/>
                <p style={{margin:0,fontSize:10,color:C.muted,lineHeight:1.6}}>
                  GLORYS model levels. 0 m excluded — no valid reanalysis values
                  at the sea surface in the training data.
                </p>
              </>
            )}
          </Card>

          {/* 7 & 8 — Region cards */}
          {regions.map((reg,ri)=>{
            const r  = FOCUS[ri];
            const ac = ACCENT[ri];
            const d  = reg.data;
            return (
              <Card key={reg.label} title={reg.label} accent={ac}
                badge={!reg.loading&&d
                  ? <Badge color={C.green} dot>{d.date??CONFIG.DEFAULT_DATE}</Badge>
                  : !reg.loading&&reg.error
                    ? <Badge color={C.red}>FAILED</Badge>
                    : reg.loading?<Badge color={C.amber}>LOADING</Badge>:null}>
                <KV k="Centre" v={`${r.lat}°N, ${r.lon}°E`}/>
                {reg.loading?<Spin/>:reg.error?<Err msg={reg.error}/>:d?(
                  <>
                    <KV k="Grid snap" v={`${d.grid_latitude}°N, ${d.grid_longitude}°E`}/>
                    <Divider/>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7,marginBottom:10}}>
                      <Tile label="Surface"   value={d.surface_temp_c?.toFixed(1)??d.temperature_c[0].toFixed(1)} unit="°C" color={C.red}/>
                      <Tile label="@ 1000m"   value={d.deep_temp_c?.toFixed(1)??d.temperature_c[d.temperature_c.length-1].toFixed(1)} unit="°C" color={C.blue}/>
                      <Tile label="Mean"      value={d.mean_temp_c?.toFixed(2)??'—'} unit="°C" color={C.cyan}/>
                      <Tile label="Range"     value={d.temp_range_c?.toFixed(2)??'—'} unit="°C" color={C.amber}/>
                    </div>
                    {d.thermocline_depth_m&&<KV k="Thermocline" v={`${d.thermocline_depth_m} m`} vc={C.violet}/>}
                    <KV k="Date"   v={d.date??'—'}/>
                    <KV k="Snapped lat" v={`${d.grid_latitude}°`}/>
                    <KV k="Snapped lon" v={`${d.grid_longitude}°`}/>
                    <Divider/>
                    <p style={{margin:'0 0 6px',fontSize:9,color:C.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>Profile</p>
                    <Sparkline temps={d.temperature_c} depths={d.depths_m}/>
                    <Divider/>
                    <p style={{margin:'0 0 18px',fontSize:9,color:C.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>Thermal cross-section</p>
                    <ThermStrip temps={d.temperature_c} depths={d.depths_m} thermoclineDepth={d.thermocline_depth_m}/>
                  </>
                ):null}
              </Card>
            );
          })}

          {/* 9 — Combined stats */}
          {stats&&(
            <Card title="Combined Statistics" accent={C.violet}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7,marginBottom:4}}>
                <Tile label="Global Max"  value={stats.max.toFixed(2)}  unit="°C" color={C.red}/>
                <Tile label="Global Min"  value={stats.min.toFixed(2)}  unit="°C" color={C.blue}/>
                <Tile label="Global Mean" value={stats.mean.toFixed(2)} unit="°C" color={C.cyan}/>
                <Tile label="Std Dev"     value={stats.std.toFixed(3)}  unit="°C" color={C.violet}/>
              </div>
              <KV k="Data points" v={`${stats.n} (${FOCUS.length} regions × ${CONFIG.TARGET_DEPTHS.length} depths)`}/>
              <KV k="Range"       v={`${(stats.max-stats.min).toFixed(2)}°C`}/>
            </Card>
          )}

          {/* 10 — Full bar chart: Arabian Sea */}
          {profileMap[CONFIG.ARABIAN_SEA.label]&&(
            <Card title={`${CONFIG.ARABIAN_SEA.label} — Full Depth Profile`} accent={C.cyan} col={2}>
              <TempBars
                depths={profileMap[CONFIG.ARABIAN_SEA.label].depths_m}
                temps={profileMap[CONFIG.ARABIAN_SEA.label].temperature_c}
              />
            </Card>
          )}

          {/* 11 — Full bar chart: Bay of Bengal */}
          {profileMap[CONFIG.BAY_OF_BENGAL.label]&&(
            <Card title={`${CONFIG.BAY_OF_BENGAL.label} — Full Depth Profile`} accent={C.blue} col={2}>
              <TempBars
                depths={profileMap[CONFIG.BAY_OF_BENGAL.label].depths_m}
                temps={profileMap[CONFIG.BAY_OF_BENGAL.label].temperature_c}
              />
            </Card>
          )}

          {/* 12 — Comparison table */}
          {bothLoaded&&(
            <Card title="Side-by-side Comparison" accent={C.amber}
              col={3}
              badge={<span style={{fontSize:10,color:C.muted,fontFamily:C.sans}}>
                Δ = {CONFIG.ARABIAN_SEA.label} − {CONFIG.BAY_OF_BENGAL.label}
              </span>}>
              <CmpTable profiles={profileMap}/>
            </Card>
          )}

          {/* 13 — Model pipeline description */}
          <Card title="Inference Pipeline" accent={C.dim} col={2}>
            {[
              ['①', 'Input',       'date + lat + lon → nearest grid cell (0.25° snap)'],
              ['②', 'Date seq',    'Build [D-2, D-1, D] date sequence'],
              ['③', 'Load data',   'Read surface_YYYY.nc for required years'],
              ['④', 'Preprocess',  'Normalise 7 vars + compute 7 validity masks → [T,14,100,240]'],
              ['⑤', 'Patch',       `Extract ${info?.model?.patch_size??32}×${info?.model?.patch_size??32} patches with stride ${info?.model?.patch_stride??32}`],
              ['⑥', 'Infer',       'OceanEmbedNet: [N,T,14,32,32] → [N,14,32,32]'],
              ['⑦', 'Reconstruct', 'Average-overlap patches → [14,100,240]'],
              ['⑧', 'Extract',     'Index at (lat_idx, lon_idx) → [14]'],
              ['⑨', 'Denorm',      'temperature = pred × target_std + target_mean'],
              ['⑩', 'Respond',     'Return 14 depths + analytics (thermocline, range, mean)'],
            ].map(([step,label,desc])=>(
              <div key={step} style={{ display:'flex', gap:10, padding:'5px 0', borderBottom:`1px solid ${C.border}` }}>
                <span style={{ fontSize:12, color:C.dim, flexShrink:0 }}>{step}</span>
                <span style={{ fontSize:11, color:C.cyan, fontFamily:C.mono, width:90, flexShrink:0 }}>{label}</span>
                <span style={{ fontSize:11, color:C.muted }}>{desc}</span>
              </div>
            ))}
          </Card>

          {/* 14 — Focus regions reference */}
          <Card title="Focus Regions" accent={C.cyan}>
            {(info?.focus_regions??FOCUS.map(r=>({name:r.label,lat:r.lat,lon:r.lon}))).map(r=>(
              <div key={r.name} style={{
                background:C.raised, border:`1px solid ${C.border}`,
                borderRadius:6, padding:'10px 12px', marginBottom:8,
              }}>
                <div style={{ fontWeight:700, fontSize:13, marginBottom:6 }}>🌊 {r.name}</div>
                <KV k="Centre lat" v={`${r.lat}°N`}/>
                <KV k="Centre lon" v={`${r.lon}°E`}/>
                {profileMap[r.name]&&(
                  <KV k="Surface temp"
                    v={`${profileMap[r.name].temperature_c[0].toFixed(1)}°C`}
                    vc={C.red}/>
                )}
              </div>
            ))}
          </Card>

        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <footer style={{
          marginTop:28, paddingTop:14, borderTop:`1px solid ${C.border}`,
          display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:6,
        }}>
          <span style={{ fontSize:10, color:C.dim, fontFamily:C.mono }}>
            OceanEmbedNet · Indian Ocean Subsurface Temperature Prediction
          </span>
          <span style={{ fontSize:10, color:C.dim, fontFamily:C.mono }}>
            Grid: {CONFIG.GRID.LAT_MIN}–{CONFIG.GRID.LAT_MAX}°N · {CONFIG.GRID.LON_MIN}–{CONFIG.GRID.LON_MAX}°E · 0.25° res
          </span>
        </footer>
      </div>
    </>
  );
}
