// Maritime Command System — Panels.jsx
import React, { useState, useCallback } from 'react';
import { useStore } from '../store';

const SEV = {
  5: { color:'#c0392b', label:'CRITICAL' },
  4: { color:'#c07c2b', label:'HIGH'     },
  3: { color:'#1a6b95', label:'MEDIUM'   },
  2: { color:'#2e7d6e', label:'LOW'      },
  1: { color:'#81A6C6', label:'INFO'     },
};

const STATUS_COLOR = {
  normal:            '#2e7d6e',
  rerouting:         '#c07c2b',
  distressed:        '#c0392b',
  stopped:           '#81A6C6',
  stranded:          '#7b3fa0',
  arrived:           '#1a6b95',
  insufficient_fuel: '#b85c00',
};
function sc(s) { return STATUS_COLOR[s] || '#81A6C6'; }
function fmtEta(sec) {
  if (!sec) return '—';
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60);
  return h>0 ? `${h}h ${m}m` : `${m}m`;
}

function DataCell({ label, value, warn }) {
  return (
    <div style={{background:warn?'#fff0ed':'#FFFAF0',border:`1px solid ${warn?'#c0392b44':'#FFFAF0'}`,borderRadius:9,padding:'8px 10px'}}>
      <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.16em',textTransform:'uppercase',color:'#81A6C6',marginBottom:3}}>{label}</div>
      <div style={{fontFamily:'monospace',fontSize:13,fontWeight:700,color:warn?'#c0392b':'#2b3b49'}}>{value}</div>
    </div>
  );
}

// ── Alert Panel ───────────────────────────────────────────────────────────────
export function AlertPanel() {
  const alerts   = useStore(s => s.alerts);
  const ackAlert = useStore(s => s.ackAlert);

  if (!alerts.length) return (
    <div className="panel-empty">All clear — no active alerts</div>
  );
  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {alerts.slice().sort((a,b)=>(b.severity||0)-(a.severity||0)).map(a => {
        const sev = SEV[a.severity] || SEV[3];
        return (
          <div key={a.id} style={{background:'#ffffff',border:`1px solid #D2C4B4`,borderLeft:`3px solid ${sev.color}`,borderRadius:10,padding:'10px 12px',marginBottom:2}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:10,fontWeight:800,letterSpacing:'0.12em',color:sev.color}}>{sev.label}</span>
              <span style={{fontSize:10,color:'#81A6C6',fontWeight:700,letterSpacing:'0.1em'}}>{a.type?.toUpperCase()}</span>
            </div>
            <div style={{fontSize:12,color:'#2b3b49',marginBottom:7,lineHeight:1.45}}>{a.message}</div>
            {a.ai_extraction && (
              <div style={{display:'flex',alignItems:'flex-start',gap:7,background:'#EEF4F8',border:'1px solid #AACDDC',borderRadius:7,padding:'6px 9px',fontSize:11,color:'#1a6b95',marginBottom:7,lineHeight:1.4}}>
                <span style={{fontSize:9,fontWeight:800,background:'#81A6C6',color:'#fff',borderRadius:4,padding:'2px 5px',flexShrink:0}}>EXT</span>
                <span>{a.ai_extraction.incident_type} · {a.ai_extraction.injury_count ?? 0} inj · {a.ai_extraction.immediate_needs}</span>
              </div>
            )}
            <button
              onClick={()=>ackAlert(a.id)}
              style={{width:'100%',padding:5,borderRadius:6,border:'1px solid #D2C4B4',background:'#F3E3D0',color:'#5f6b77',fontSize:11,fontWeight:700,cursor:'pointer'}}>
              Acknowledge
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Ship List ─────────────────────────────────────────────────────────────────
export function ShipList({ onSelect }) {
  const ships          = useStore(s => s.ships);
  const selectedShipId = useStore(s => s.selectedShipId);
  const [search, setSearch] = React.useState('');
  const filtered = ships.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{position:'relative',marginBottom:8}}>
        <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',pointerEvents:'none',display:'flex',alignItems:'center'}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#81A6C6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </span>
        <input
          id="ship-search"
          value={search}
          onChange={e=>setSearch(e.target.value)}
          placeholder="Search vessels…"
          style={{width:'100%',paddingLeft:30,padding:'7px 30px 7px 30px',border:'1px solid #D2C4B4',borderRadius:8,fontSize:12,background:'#ffffff',color:'#2b3b49',outline:'none',boxSizing:'border-box'}}
        />
        {search && (
          <button
            onClick={()=>setSearch('')}
            style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#81A6C6',fontSize:14,lineHeight:1,padding:'0 2px'}}
            aria-label="Clear search"
          >x</button>
        )}
      </div>
      {filtered.length===0 && <div className="panel-empty">No vessels found</div>}
      {filtered.map(s => {
        const color = sc(s.status);
        const fp = Math.min(100, ((s.fuel||0)/8500)*100);
        const sel = selectedShipId===s.id;
        return (
          <div
            key={s.id}
            onClick={()=>onSelect(s.id)}
            style={{
              background: sel ? '#EEF4F8' : '#fafafa',
              border: `1px solid ${sel ? '#81A6C6' : '#D2C4B4'}`,
              boxShadow: sel ? '0 2px 8px rgba(129,166,198,0.2)' : 'none',
              borderRadius:10, padding:'9px 11px', cursor:'pointer',
              marginBottom:5, transition:'all 0.15s'
            }}
          >
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:2}}>
              <span style={{fontSize:13,fontWeight:700,color:'#2b3b49'}}>{s.name}</span>
              <span style={{fontSize:9,fontWeight:800,letterSpacing:'0.1em',textTransform:'uppercase',padding:'2px 7px',borderRadius:999,color,background:`${color}18`,border:`1px solid ${color}33`}}>
                {s.status?.replace(/_/g,' ')}
              </span>
            </div>
            <div style={{fontSize:10,color:'#81A6C6',marginBottom:6}}>{s.id} · {s.type||'Cargo'} · {s.flag||'—'}</div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{flex:1,height:3,background:'#D2C4B4',borderRadius:2,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${fp}%`,background:fp>50?'#2e7d6e':fp>20?'#c07c2b':'#c0392b',borderRadius:2,transition:'width 0.6s ease'}} />
              </div>
              <span style={{fontSize:10,color:'#5f6b77',whiteSpace:'nowrap'}}>→ {s.destination_port}</span>
              {!s.can_reach_dest && s.status!=='arrived' && <span style={{fontSize:9,color:'#c0392b',fontWeight:700}}>LOW FUEL</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Zone Panel (delete restricted zones) ─────────────────────────────────────
export function ZonePanel() {
  const zones      = useStore(s => s.zones);
  const deleteZone = useStore(s => s.deleteZone);
  const [deleting, setDeleting] = React.useState(null);

  if (!zones.length) return (
    <div className="panel-empty">No restricted zones drawn yet</div>
  );
  return (
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      {zones.map(z => (
        <div key={z.id} style={{background:'#FFFAF0',border:'1px solid #FFFAF0',borderRadius:9,padding:'8px 11px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:'#c0392b'}}>{z.name}</div>
            <div style={{fontSize:10,color:'#81A6C6'}}>{z.polygon?.length||0} vertices</div>
          </div>
          <button
            onClick={async()=>{setDeleting(z.id);try{await deleteZone(z.id);}finally{setDeleting(null);}}}
            disabled={deleting===z.id}
            style={{padding:'4px 10px',borderRadius:7,border:'1px solid #f5b8b8',background:deleting===z.id?'#FFFAF0':'#fff',color:'#c0392b',fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0,opacity:deleting===z.id?0.6:1}}>
            {deleting===z.id?'…':'Delete'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Weather Panel ────────────────────────────────────────────────────────────
export function WeatherPanel() {
  const weatherZones = useStore(s => s.weatherZones);
  const ships = useStore(s => s.ships);

  if (!weatherZones.length) return (
    <div className="panel-empty">No adverse weather detected</div>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {weatherZones.map((wz, idx) => {
        const shipsInWeather = ships.filter(s =>
          !['arrived', 'stopped', 'stranded'].includes(s.status) &&
          Math.sqrt((s.lat - wz.lat) ** 2 + (s.lng - wz.lng) ** 2) * 111.32 < wz.radius_km
        );
        const intensity = (wz.intensity || 50) / 100;
        const intensityColor = intensity > 0.7 ? '#c0392b' : intensity > 0.4 ? '#e67e22' : '#f39c12';
        
        return (
          <div key={idx} style={{background:'#fff',border:`1px solid ${intensityColor}44`,borderLeft:`4px solid ${intensityColor}`,borderRadius:9,padding:'10px 12px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
              <div style={{fontSize:12,fontWeight:700,color:'#2b3b49'}}>{wz.description}</div>
              <div style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:4,background:intensityColor,color:'#fff'}}>
                {Math.round(intensity * 100)}% intensity
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:7,marginBottom:8,fontSize:11,color:'#5f7c8d'}}>
              <div><strong>Wind:</strong> {wz.wind_knots || 0} kn</div>
              <div><strong>Waves:</strong> {wz.wave_height_m || 0} m</div>
              <div><strong>Precip:</strong> {wz.precipitation_mm || 0} mm</div>
              <div><strong>Visibility:</strong> {wz.visibility_km || 10} km</div>
            </div>
            <div style={{fontSize:11,color:'#81A6C6',background:'#EEF4F8',padding:'6px 8px',borderRadius:6}}>
               <strong>{shipsInWeather.length}</strong> ship{shipsInWeather.length !== 1 ? 's' : ''} in weather zone — experiencing +30% fuel burn
              {shipsInWeather.length > 0 && (
                <div style={{fontSize:10,marginTop:4,opacity:0.8}}>
                  {shipsInWeather.map(s => s.name).join(', ')}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Ship-to-Ship Operations sub-component ────────────────────────────────────
function ShipToShipOps({ ship, issue, sending }) {
  const ships = useStore(s => s.ships);
  const sendDirective = useStore(s => s.sendDirective);
  // Other ships that are active (not arrived/stranded with no path)
  const targets = ships.filter(s =>
    s.id !== ship.id && !['arrived'].includes(s.status)
  );

  const FUEL_RESERVE = 1000;
  const FUEL_CAPACITY = 8500;

  const [targetId, setTargetId]     = React.useState('');
  const [fuelAmt,  setFuelAmt]      = React.useState(500);
  const [s2sErr,   setS2sErr]       = React.useState('');
  const [s2sFeedback, setS2sFeedback] = React.useState('');
  const [s2sSending, setS2sSending]   = React.useState(false);

  // Pick first target automatically when list changes and nothing is selected
  React.useEffect(() => {
    if (!targetId && targets.length) setTargetId(targets[0].id);
  }, [targets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const target = ships.find(s => s.id === targetId);
  const isEscorting = !!ship._escorting;

  // --- Computed validation ---
  const donorAvailable = Math.max(0, (ship.fuel || 0) - FUEL_RESERVE);
  const targetRoom = target ? Math.max(0, FUEL_CAPACITY - (target.fuel || 0)) : 0;
  const maxTransferable = FUEL_CAPACITY;
  const donorTooLow = (ship.fuel || 0) < FUEL_RESERVE;

  async function s2s(type, extra = {}) {
    if (!targetId && type !== 'CANCEL_ESCORT') { setS2sErr('Select a target ship first'); return; }
    setS2sErr(''); setS2sFeedback(''); setS2sSending(true);
    try {
      const result = await sendDirective(ship.id, type, { target_ship_id: targetId, ...extra });
      // Show detailed feedback for fuel transfers
      if (type === 'FUEL_TRANSFER' && result?.result) {
        const r = result.result;
        const msg = r.was_clamped
          ? `Transferred ${r.actual_amount}t (requested ${r.requested_amount}t, clamped). Donor: ${r.donor_fuel_after}t, Target: ${r.target_fuel_after}t`
          : `Transferred ${r.actual_amount}t successfully. Donor: ${r.donor_fuel_after}t, Target: ${r.target_fuel_after}t`;
        setS2sFeedback(msg);
      } else {
        setS2sFeedback('Operation sent successfully');
      }
    } catch (err) {
      setS2sErr(err.message || 'Operation failed');
    }
    setS2sSending(false);
    setTimeout(() => { setS2sFeedback(''); setS2sErr(''); }, 5000);
  }

  const SEL_STYLE = {
    width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 12,
    border: '1px solid #AACDDC', background: '#EEF4F8', color: '#2b3b49',
    outline: 'none', cursor: 'pointer',
  };
  const BTN = (bg, col, border = 'none') => ({
    flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
    cursor: (sending || s2sSending) ? 'default' : 'pointer', border, background: bg, color: col,
    opacity: (sending || s2sSending) ? 0.4 : 1, transition: 'all 0.18s', whiteSpace: 'nowrap',
  });

  const fuelTransferDisabled = s2sSending || sending || fuelAmt < 50 || !target;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:8,paddingTop:12,borderTop:'1px solid #FFFAF0'}}>
      <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.18em',textTransform:'uppercase',color:'#81A6C6'}}>
        Ship-to-Ship Ops
      </div>

      {targets.length === 0 ? (
        <div style={{fontSize:11,color:'#81A6C6',padding:'6px 10px',background:'#FFFAF0',borderRadius:7}}>
          No other active ships available
        </div>
      ) : (
        <>
          {/* Target selector */}
          <select value={targetId} onChange={e => setTargetId(e.target.value)} style={SEL_STYLE}>
            {targets.map(t => {
              const fp = Math.min(100, ((t.fuel||0)/FUEL_CAPACITY)*100).toFixed(0);
              return (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.status?.replace(/_/g,' ')}) — {Math.round(t.fuel||0)}t ({fp}%)
                </option>
              );
            })}
          </select>

          {/* Target quick-stats */}
          {target && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:5}}>
              {[
                { l:'Dist', v: target.dist_to_dest_km ? `${target.dist_to_dest_km}km` : '—' },
                { l:'Fuel', v: `${Math.round(target.fuel||0)}t` },
                { l:'Room', v: `${Math.round(targetRoom)}t` },
              ].map(({ l, v }) => (
                <div key={l} style={{background:'#FFFAF0',borderRadius:7,padding:'5px 7px',textAlign:'center'}}>
                  <div style={{fontSize:8,fontWeight:800,letterSpacing:'0.14em',textTransform:'uppercase',color:'#81A6C6',marginBottom:1}}>{l}</div>
                  <div style={{fontSize:11,fontWeight:700,color:'#2b3b49',fontFamily:'monospace'}}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {/* Fuel Transfer */}
          <div style={{background:'#f7fbfe',border:'1px solid #AACDDC',borderRadius:9,padding:'9px 11px'}}>
            <div style={{fontSize:10,fontWeight:700,color:'#1a6b95',letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:6}}>
               Fuel Transfer
            </div>

            {/* Donor reserve warning */}
            {donorTooLow && (
              <div style={{fontSize:11,color:'#c0392b',fontWeight:600,padding:'5px 9px',
                background:'#fef0f0',border:'1px solid #f5b8b8',borderRadius:7,marginBottom:7}}>
                ⚠ {ship.name} only has {Math.round(ship.fuel||0)}t fuel — minimum {FUEL_RESERVE}t reserve required to donate
              </div>
            )}

            {/* Target full warning */}
            {target && targetRoom <= 0 && (
              <div style={{fontSize:11,color:'#c07c2b',fontWeight:600,padding:'5px 9px',
                background:'#FFFAF0',border:'1px solid #D2C4B4',borderRadius:7,marginBottom:7}}>
                ⚠ {target.name} is at full capacity ({FUEL_CAPACITY}t)
              </div>
            )}

            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
              <input
                type="range" min={100} max={Math.max(100, Math.floor(maxTransferable / 100) * 100 || 100)} step={100}
                value={Math.min(fuelAmt, Math.max(100, maxTransferable))} onChange={e => setFuelAmt(Number(e.target.value))}
                style={{flex:1,accentColor:'#1a6b95'}}
              />
              <span style={{fontSize:12,fontFamily:'monospace',fontWeight:700,color:'#2b3b49',minWidth:48}}>
                {fuelAmt}t
              </span>
            </div>

            {/* Transfer info line */}
            {!donorTooLow && target && maxTransferable > 0 && (
              <div style={{fontSize:10,color:'#81A6C6',marginBottom:7,lineHeight:1.4}}>
                Max transferable: <strong>{Math.round(maxTransferable)}t</strong> · 
                Donor after: <strong>{Math.round((ship.fuel||0) - fuelAmt)}t</strong> · 
                Target after: <strong>{Math.round((target.fuel||0) + fuelAmt)}t</strong>
              </div>
            )}

            <button
              disabled={fuelTransferDisabled}
              onClick={() => s2s('FUEL_TRANSFER', { amount_tonnes: fuelAmt })}
              style={{...BTN('#EEF4F8','#1a6b95','1px solid #AACDDC'), opacity: fuelTransferDisabled ? 0.35 : 1}}>
               Transfer {fuelAmt}t to {target?.name || '—'}
            </button>
          </div>

          {/* Escort / Cancel */}
          <div style={{display:'flex',gap:7}}>
            {isEscorting ? (
              <button
                disabled={sending || s2sSending}
                onClick={() => { setS2sErr(''); setS2sFeedback(''); issue('CANCEL_ESCORT', {}); }}
                style={BTN('#fff0ed','#c0392b','1px solid #f5b8b8')}>
                Cancel Escort
              </button>
            ) : (
              <button
                disabled={sending || s2sSending}
                onClick={() => s2s('ESCORT')}
                style={BTN('#FFFAF0','#92501a','1px solid #D2C4B4')}>
                Escort {target?.name || '—'}
              </button>
            )}
            <button
              disabled={sending || s2sSending}
              onClick={() => s2s('MEDICAL_AID')}
              style={BTN('#fef0f0','#b91c1c','1px solid #f5b8b8')}>
              Medical Aid
            </button>
          </div>

          {s2sFeedback && (
            <div style={{fontSize:11,fontWeight:600,padding:'6px 9px',
              background:'#e6f7f0',border:'1px solid #a8dcc5',borderRadius:7,color:'#1a6b4a',lineHeight:1.4}}>
              ✓ {s2sFeedback}
            </div>
          )}

          {s2sErr && (
            <div style={{fontSize:11,color:'#c0392b',fontWeight:600,padding:'5px 9px',
              background:'#fef0f0',border:'1px solid #f5b8b8',borderRadius:7,lineHeight:1.4}}>
              ✗ {s2sErr}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Ship Detail ───────────────────────────────────────────────────────────────
export function ShipDetail({ shipId }) {
  const ship          = useStore(s => s.ships.find(x => x.id===shipId));
  const sendDirective = useStore(s => s.sendDirective);
  const fetchRoutes   = useStore(s => s.fetchRoutes);
  const setPreviewRoute  = useStore(s => s.setPreviewRoute);
  const clearRoutePreview = useStore(s => s.clearRoutePreview);
  const routeOptions  = useStore(s => s.routeOptions);
  const previewRouteId = useStore(s => s.previewRouteId);

  const [portId, setPortId]   = React.useState('');
  const [feedback, setFeedback] = React.useState('');
  const [sending, setSending]  = React.useState(false);
  const [loadingRoutes, setLoadingRoutes] = React.useState(false);
  const [routeErr, setRouteErr] = React.useState('');

  if (!shipId) return (
    <div className="panel-empty">
      <span>Select a ship to view details and issue directives</span>
    </div>
  );
  if (!ship) return (
    <div className="panel-empty">
      <span>Loading ship data…</span>
    </div>
  );

  const color = sc(ship.status);
  const fp    = Math.min(100, ((ship.fuel||0)/8500)*100);

  async function issue(type, payload={}) {
    setSending(true); setFeedback('');
    try {
      await sendDirective(ship.id, type, payload);
      setFeedback('Directive sent');
    } catch (err) {
      setFeedback(err.message || 'Failed to send');
    }
    setSending(false);
    setTimeout(()=>setFeedback(''),5000);
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8,paddingBottom:11,borderBottom:'1px solid #AACDDC'}}>
        <div>
          <div style={{fontFamily:'var(--font-display)',fontSize:18,fontWeight:700,color:'#2b3b49'}}>{ship.name}</div>
          <div style={{fontSize:11,color:'#81A6C6',marginTop:2}}>{ship.type||'Cargo'} · {ship.flag||'—'}</div>
        </div>
        <span style={{fontSize:9,fontWeight:800,letterSpacing:'0.1em',textTransform:'uppercase',padding:'3px 10px',borderRadius:999,whiteSpace:'nowrap',flexShrink:0,color,background:`${color}18`,border:`1px solid ${color}33`}}>
          {ship.status?.replace(/_/g,' ')}
        </span>
      </div>

      {/* Data grid */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
        <DataCell label="Speed"   value={`${ship.speed||0} kn`} />
        <DataCell label="Heading" value={`${Math.round(ship.heading||0)}°`} />
        <DataCell label="Dest"    value={ship.destination_port} />
        <DataCell label="ETA"     value={fmtEta(ship.eta_seconds)} />
        <DataCell label="Dist"    value={ship.dist_to_dest_km ? `${ship.dist_to_dest_km} km` : '—'} />
        <DataCell label="Runway"  value={ship.fuel_runway_km ? `${ship.fuel_runway_km} km` : '—'} warn={!ship.can_reach_dest} />
        <DataCell label="Weather"  value={ship.weather_penalty?'Storm':'Clear'} warn={!!ship.weather_penalty} />
      </div>

      {/* Position */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
        <DataCell label="Lat" value={ship.lat?.toFixed(4)||'—'} />
        <DataCell label="Lng" value={ship.lng?.toFixed(4)||'—'} />
      </div>

      {/* Fuel */}
      <div>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:11,fontWeight:700,color:'#81A6C6',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>
          <span>Fuel</span>
          <span style={{fontFamily:'monospace',color:fp>50?'#2e7d6e':fp>20?'#c07c2b':'#c0392b'}}>{ship.fuel?.toFixed(0)||0} t ({fp.toFixed(0)}%)</span>
        </div>
        <div style={{height:6,background:'#FFFAF0',borderRadius:3,overflow:'hidden'}}>
          <div style={{height:'100%',width:`${fp}%`,background:fp>50?'#2e7d6e':fp>20?'#c07c2b':'#c0392b',borderRadius:3,transition:'width 0.6s ease'}} />
        </div>
        {!ship.can_reach_dest && <div style={{marginTop:6,padding:'5px 10px',background:'#fef0f0',border:'1px solid #f5b8b8',borderRadius:7,fontSize:11,color:'#c0392b',fontWeight:600}}>Insufficient fuel to reach {ship.destination_port}</div>}
      </div>

      {/* Cargo */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 10px',background:'#EEF4F8',border:'1px solid #AACDDC',borderRadius:8}}>
        <span style={{fontSize:11,color:'#81A6C6',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.12em'}}>Cargo</span>
        <span style={{fontSize:13,fontWeight:600,color:'#2b3b49'}}>{ship.cargo||'—'}</span>
      </div>

      {/* Weather */}
      {ship.weather_penalty && (
        <div style={{padding:'10px',background:'#FFFAF0',border:'1px solid #e8b88f',borderRadius:8,fontSize:11,color:'#1a6b95',fontWeight:600}}>
          <div style={{marginBottom:6}}><strong>Adverse Weather Active</strong> — +30% fuel burn</div>
          <div style={{fontSize:10,color:'#5f7c8d',lineHeight:'1.4'}}>
            Your ship is currently in a storm zone. Monitor fuel carefully and consider rerouting if fuel status is critical.
          </div>
        </div>
      )}

      {/* Directives */}
      <div style={{display:'flex',flexDirection:'column',gap:8,paddingTop:12,borderTop:'1px solid #FFFAF0'}}>
        <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.18em',textTransform:'uppercase',color:'#81A6C6'}}>Issue Directive</div>
        <button
          disabled={sending}
          onClick={()=>issue('HOLD_POSITION')}
          style={{padding:'8px 12px',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',border:'1px solid #FFFAF0',background:'#FFFAF0',color:'#92501a',transition:'all 0.18s',opacity:sending?0.4:1}}>
          Hold Position
        </button>
        <div style={{display:'flex',gap:8}}>
          <input
            value={portId}
            onChange={e=>setPortId(e.target.value)}
            placeholder="Port ID (e.g. DXB-1)"
            style={{flex:1,background:'#FFFAF0',border:'1px solid #FFFAF0',borderRadius:8,color:'#2b3b49',padding:'8px 11px',fontSize:12,outline:'none'}}
          />
          <button
            disabled={sending||!portId.trim()}
            onClick={()=>{if(portId.trim())issue('REROUTE_PORT',{port_id:portId.trim()});}}
            style={{padding:'8px 12px',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',border:'1px solid #AACDDC',background:'#EEF4F8',color:'#1a6b95',whiteSpace:'nowrap',opacity:(sending||!portId.trim())?0.4:1}}>
            Reroute
          </button>
        </div>
        {feedback && (
          <div style={{fontSize:12,fontWeight:700,padding:'7px 12px',borderRadius:7,textAlign:'center',lineHeight:1.4,
            background:feedback==='Directive sent'?'#e6f7f0':'#fef0f0',
            color:feedback==='Directive sent'?'#1a6b4a':'#b91c1c',
            border:`1px solid ${feedback==='Directive sent'?'#a8dcc5':'#f5b8b8'}`}}>
            {feedback==='Directive sent'?'✓ ':'✗ '}{feedback}
          </div>
        )}
      </div>

      {/* Ship-to-Ship Operations */}
      <ShipToShipOps ship={ship} issue={issue} sending={sending} />

      {/* Route Options */}
      <div style={{display:'flex',flexDirection:'column',gap:8,paddingTop:12,borderTop:'1px solid #FFFAF0'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.18em',textTransform:'uppercase',color:'#81A6C6'}}>Route Options</div>
          {routeOptions?.ship_id === ship.id && (
            <button
              onClick={clearRoutePreview}
              style={{fontSize:10,fontWeight:700,color:'#81A6C6',background:'none',border:'none',cursor:'pointer',padding:'2px 6px'}}>
              Clear
            </button>
          )}
        </div>

        {(!routeOptions || routeOptions.ship_id !== ship.id) ? (
          <button
            disabled={loadingRoutes}
            onClick={async () => {
              setLoadingRoutes(true); setRouteErr('');
              try { await fetchRoutes(ship.id); }
              catch(e) { setRouteErr('Failed to load routes — is backend running?'); }
              setLoadingRoutes(false);
            }}
            style={{padding:'8px 12px',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',
              border:'1px solid #AACDDC',background:'#EEF4F8',color:'#1a6b95',
              opacity:loadingRoutes?0.5:1,transition:'all 0.18s'}}>
            {loadingRoutes ? 'Computing…' : 'Show Route Options'}
          </button>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {routeOptions.routes.map(r => {
              const sel = r.id === previewRouteId;
              const ICONS = { safe:'🛡', fast:'⚡', eco:'🍃' };
              return (
                <div
                  key={r.id}
                  onClick={() => setPreviewRoute(r.id)}
                  style={{
                    border:`2px solid ${sel ? r.color : '#D2C4B4'}`,
                    borderRadius:10, padding:'9px 11px', cursor:'pointer',
                    background: sel ? `${r.color}12` : '#fafafa',
                    transition:'all 0.15s',
                  }}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3}}>
                    <span style={{fontSize:13,fontWeight:800,color:r.color}}>
                      {ICONS[r.id] || ''} {r.label}
                    </span>
                    <span style={{fontSize:11,fontFamily:'monospace',fontWeight:700,color:'#2b3b49'}}>
                      {r.distKm} km
                    </span>
                  </div>
                  <div style={{fontSize:11,color:'#5f6b77',marginBottom:5,lineHeight:1.4}}>{r.description}</div>
                  <div style={{display:'flex',gap:6}}>
                    <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:999,
                      background:`${r.color}18`,color:r.color,border:`1px solid ${r.color}33`}}>
                      {r.distKm} km
                    </span>
                    <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:999,
                      background: r.weatherCells > 0 ? '#fff0ed' : '#e6f7f0',
                      color: r.weatherCells > 0 ? '#c0392b' : '#1a6b4a',
                      border:`1px solid ${r.weatherCells > 0 ? '#f5b8b8' : '#a8dcc5'}`}}>
                      {r.weatherCells > 0 ? ` ${r.weatherCells} weather pts` : ' Clear'}
                    </span>
                    {sel && <span style={{fontSize:10,fontWeight:800,padding:'2px 7px',borderRadius:999,background:'#EEF4F8',color:'#1a6b95',border:'1px solid #AACDDC'}}>Selected</span>}
                  </div>
                </div>
              );
            })}
            <button
              disabled={sending || !previewRouteId}
              onClick={async () => {
                const chosen = routeOptions.routes.find(r => r.id === previewRouteId);
                if (!chosen) return;
                setSending(true); setFeedback('');
                try {
                  await sendDirective(ship.id, 'SET_ROUTE_PATH', { path: chosen.path });
                  setFeedback(`${chosen.label} route committed`);
                  clearRoutePreview();
                } catch { setFeedback('Failed to commit route'); }
                setSending(false);
                setTimeout(()=>setFeedback(''), 3000);
              }}
              style={{padding:'9px 12px',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',
                border:'none',background:sending||!previewRouteId?'#FFFAF0':'#2e7d6e',
                color:'#fff',transition:'background 0.2s',opacity:sending||!previewRouteId?0.4:1}}>
              {sending ? '…' : 'Commit Selected Route'}
            </button>
          </div>
        )}

        {routeErr && (
          <div style={{fontSize:11,color:'#c0392b',fontWeight:600,padding:'6px 10px',
            background:'#fef0f0',border:'1px solid #f5b8b8',borderRadius:7}}>
            {routeErr}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Captain Panel ─────────────────────────────────────────────────────────────
export function CaptainPanel({ shipId }) {
  const ships             = useStore(s => s.ships);
  const connected         = useStore(s => s.connected);
  const pendingDirectives = useStore(s => s.pendingDirectives);
  const respondDirective  = useStore(s => s.respondDirective);
  const sendDistress      = useStore(s => s.sendDistress);
  const [distressInput, setDistressInput] = React.useState('');
  const [result, setResult]   = React.useState(null);
  const [sending, setSending] = React.useState(false);

  const ship = ships.find(s => s.id===shipId);

  if (!connected) return (
    <div className="panel-empty">
      <strong style={{fontSize:14,color:'#2b3b49'}}>Connecting to backend…</strong>
      <span style={{fontSize:11}}>Please wait while the WebSocket connects</span>
    </div>
  );

  if (!ship) return (
    <div className="panel-empty">
      <strong style={{fontSize:14,color:'#2b3b49'}}>Waiting for vessel data…</strong>
      <span style={{fontSize:11}}>Awaiting {shipId} from fleet broadcast</span>
    </div>
  );

  const color = sc(ship.status);
  const fp    = Math.min(100, ((ship.fuel||0)/8500)*100);
  const mine  = pendingDirectives.filter(d => d.ship_id===shipId);

  async function handleDistress() {
    if (!distressInput.trim()) return;
    setSending(true);
    try {
      const r = await sendDistress(shipId, distressInput);
      if (r._rateLimited) {
        setResult({ _rateLimited: true, cooldown_sec: r.cooldown_sec });
        setSending(false);
        return;
      }
      setResult(r.extraction || r);
      setDistressInput('');
    } catch {
      setResult({ issue:'Error', severity:0, impact_quantified:'Request failed — check backend connection' });
    }
    setSending(false);
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8,paddingBottom:11,borderBottom:'1px solid #FFFAF0'}}>
        <div>
          <div style={{fontFamily:'var(--font-display)',fontSize:18,fontWeight:700,color:'#2b3b49'}}>{ship.name}</div>
          <div style={{fontSize:11,color:'#81A6C6',marginTop:2}}>{ship.type||'Cargo'} · {ship.flag||'—'}</div>
        </div>
        <span style={{fontSize:9,fontWeight:800,letterSpacing:'0.1em',textTransform:'uppercase',padding:'3px 10px',borderRadius:999,whiteSpace:'nowrap',flexShrink:0,color,background:`${color}18`,border:`1px solid ${color}33`}}>
          {ship.status?.replace(/_/g,' ')}
        </span>
      </div>

      {/* Stats grid */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
        <DataCell label="Speed"    value={`${ship.speed||0} kn`} />
        <DataCell label="Heading"  value={`${Math.round(ship.heading||0)}°`} />
        <DataCell label="Dest"     value={ship.destination_port} />
        <DataCell label="ETA"      value={fmtEta(ship.eta_seconds)} />
        <DataCell label="Distance" value={ship.dist_to_dest_km ? `${ship.dist_to_dest_km} km` : '—'} />
        <DataCell label="Weather"  value={ship.weather_penalty?'Storm':'Clear'} warn={!!ship.weather_penalty} />
      </div>

      {/* Fuel */}
      <div>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:11,fontWeight:700,color:'#81A6C6',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>
          <span>Fuel</span>
          <span style={{fontFamily:'monospace',color:fp>50?'#2e7d6e':fp>20?'#c07c2b':'#c0392b'}}>{ship.fuel?.toFixed(0)||0} t</span>
        </div>
        <div style={{height:6,background:'#FFFAF0',borderRadius:3,overflow:'hidden'}}>
          <div style={{height:'100%',width:`${fp}%`,background:fp>50?'#2e7d6e':fp>20?'#c07c2b':'#c0392b',borderRadius:3,transition:'width 0.6s ease'}} />
        </div>
        {!ship.can_reach_dest && <div style={{marginTop:6,padding:'5px 10px',background:'#fef0f0',border:'1px solid #f5b8b8',borderRadius:7,fontSize:11,color:'#c0392b',fontWeight:600}}>Insufficient fuel to reach {ship.destination_port}</div>}
      </div>

      {/* Cargo */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 10px',background:'#FFFAF0',border:'1px solid #FFFAF0',borderRadius:8}}>
        <span style={{fontSize:11,color:'#81A6C6',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.12em'}}>Cargo</span>
        <span style={{fontSize:13,fontWeight:600,color:'#2b3b49'}}>{ship.cargo||'—'}</span>
      </div>

      {/* Pending directives */}
      {mine.length > 0 && (
        <div style={{display:'flex',flexDirection:'column',gap:8,paddingTop:12,borderTop:'1px solid #FFFAF0'}}>
          <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.18em',textTransform:'uppercase',color:'#c07c2b'}}>Pending Directives ({mine.length})</div>
          {mine.map(d=>(
            <div key={d.id} style={{background:'#FFFAF0',border:'1px solid #FFFAF0',borderRadius:10,padding:'11px 12px'}}>
              <div style={{fontSize:13,fontWeight:800,color:'#92501a',textTransform:'uppercase',letterSpacing:'0.06em'}}>{d.type?.replace(/_/g,' ')}</div>
              {d.message && <div style={{fontSize:12,color:'#5f6b77',marginTop:4}}>{d.message}</div>}
              <div style={{display:'flex',gap:8,marginTop:8}}>
                <button
                  style={{flex:1,padding:'7px 10px',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',border:'1px solid #a8dcc5',background:'#e6f7f0',color:'#1a6b4a'}}
                  onClick={()=>respondDirective(d,'ACCEPT')}>
                  Accept
                </button>
                <button
                  style={{flex:1,padding:'7px 10px',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',border:'1px solid #f5b8b8',background:'#fef0f0',color:'#b91c1c'}}
                  onClick={()=>{
                    const m=prompt('Distress message (optional):');
                    respondDirective(d,'ESCALATE_DISTRESS',m||'');
                  }}>
                  Escalate
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Distress signal */}
      <div style={{display:'flex',flexDirection:'column',gap:8,paddingTop:12,borderTop:'2px solid #FFFAF0'}}>
        <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.18em',textTransform:'uppercase',color:'#b91c1c'}}>Distress Signal</div>
        <textarea
          value={distressInput}
          onChange={e=>setDistressInput(e.target.value)}
          placeholder="Describe the emergency in your own words. AI will extract severity, incident type, and impact…"
          rows={4}
          style={{width:'100%',background:'#FFFAF0',border:'1px solid #FFFAF0',borderRadius:9,color:'#7f1d1d',padding:'10px 12px',fontSize:12,resize:'vertical',outline:'none',lineHeight:1.5,boxSizing:'border-box',fontFamily:'inherit'}}
        />
        <button
          disabled={sending||!distressInput.trim()}
          onClick={handleDistress}
          style={{width:'100%',padding:'9px 12px',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',border:'none',background:sending||!distressInput.trim()?'#FFFAF0':'#c0392b',color:'#fff',transition:'background 0.2s'}}>
          {sending ? 'Sending\u2026' : 'Send Distress Signal'}
        </button>
        {result && (
          <div style={{background:'#FFFAF0',border:'1px solid #FFFAF0',borderRadius:10,padding:'11px 13px',display:'flex',flexDirection:'column',gap:5}}>
            <div style={{fontSize:12,fontWeight:800,color:'#1a6b95',marginBottom:3}}>
               AI Analysis \u2014 Severity {result.severity ?? result.severity_score ?? '?'}/10
            </div>
            <div style={{fontSize:12,color:'#2b3b49',display:'flex',gap:6}}>
              <span style={{color:'#81A6C6',minWidth:60}}>Issue</span>
              <strong>{result.issue || result.incident_type || '\u2014'}</strong>
            </div>
            <div style={{fontSize:12,color:'#2b3b49',display:'flex',gap:6}}>
              <span style={{color:'#81A6C6',minWidth:60}}>Impact</span>
              <strong>{result.impact_quantified || result.immediate_needs || '\u2014'}</strong>
            </div>
            {(result.injury_count !== undefined) && (
              <div style={{fontSize:12,color:'#2b3b49',display:'flex',gap:6}}>
                <span style={{color:'#81A6C6',minWidth:60}}>Injuries</span>
                <strong>{result.injury_count}</strong>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Captain-specific components (used by the 3-column CaptainApp)
// ══════════════════════════════════════════════════════════════════════════════

// ── Captain Vitals ────────────────────────────────────────────────────────────
export function CaptainVitals({ ship }) {
  if (!ship) return (
    <div className="panel-empty">
      <strong style={{fontSize:14,color:'#2b3b49'}}>Awaiting vessel data…</strong>
      <span style={{fontSize:11,color:'#81A6C6'}}>1 Hz tick will populate this panel</span>
    </div>
  );
  const color     = sc(ship.status);
  const fp        = Math.min(100, ((ship.fuel||0)/8500)*100);
  const fuelColor = fp > 50 ? '#2e7d6e' : fp > 20 ? '#c07c2b' : '#c0392b';
  return (
    <div style={{display:'flex',flexDirection:'column',gap:11}}>
      {/* Status hero */}
      <div style={{background:`${color}0d`,border:`1.5px solid ${color}33`,borderRadius:13,
        padding:'13px 14px',display:'flex',alignItems:'center',gap:12}}>
        <div style={{width:46,height:46,borderRadius:'50%',background:`${color}18`,
          border:`2px solid ${color}44`,display:'flex',alignItems:'center',
          justifyContent:'center',fontSize:13,fontWeight:800,color,flexShrink:0}}>SHIP</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:'var(--font-display)',fontSize:17,fontWeight:800,
            color:'#2b3b49',marginBottom:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {ship.name}
          </div>
          <div style={{fontSize:10,color:'#81A6C6',marginBottom:6,letterSpacing:'0.08em'}}>
            {ship.type||'Cargo'} · {ship.flag||'—'} · {ship.id}
          </div>
          <span style={{fontSize:9,fontWeight:800,letterSpacing:'0.14em',textTransform:'uppercase',
            padding:'3px 10px',borderRadius:999,color,background:`${color}18`,border:`1px solid ${color}33`}}>
            {ship.status?.replace(/_/g,' ')}
          </span>
        </div>
      </div>
      {/* Fuel gauge */}
      <div style={{background:'#f7fbfe',border:'1px solid #AACDDC',borderRadius:11,padding:'11px 13px'}}>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:10,fontWeight:800,
          letterSpacing:'0.14em',textTransform:'uppercase',color:'#81A6C6',marginBottom:8}}>
          <span>Fuel</span>
          <span style={{fontFamily:'monospace',color:fuelColor}}>{ship.fuel?.toFixed(0)||0} t · {fp.toFixed(0)}%</span>
        </div>
        <div style={{height:9,background:'#D2C4B4',borderRadius:5,overflow:'hidden',marginBottom:4}}>
          <div style={{height:'100%',width:`${fp}%`,borderRadius:5,background:fuelColor,
            transition:'width 0.7s ease',boxShadow:`0 0 10px ${fuelColor}55`}} />
        </div>
        {!ship.can_reach_dest && (
          <div style={{marginTop:6,padding:'5px 9px',background:'#fef0f0',
            border:'1px solid #f5b8b8',borderRadius:7,fontSize:11,color:'#c0392b',fontWeight:600}}>
            Insufficient fuel to reach {ship.destination_port}
          </div>
        )}
      </div>
      {/* Data grid */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
        <DataCell label="Speed"   value={`${ship.speed||0} kn`} />
        <DataCell label="Heading" value={`${Math.round(ship.heading||0)}°`} />
        <DataCell label="Dest"    value={ship.destination_port} />
        <DataCell label="ETA"     value={fmtEta(ship.eta_seconds)} />
        <DataCell label="Dist"    value={ship.dist_to_dest_km ? `${ship.dist_to_dest_km} km` : '—'} />
        <DataCell label="Runway"  value={ship.fuel_runway_km ? `${ship.fuel_runway_km} km` : '—'} warn={!ship.can_reach_dest} />
      </div>
      {/* Position */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
        <DataCell label="Lat" value={ship.lat?.toFixed(4)||'—'} />
        <DataCell label="Lng" value={ship.lng?.toFixed(4)||'—'} />
      </div>
      {/* Cargo */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
        padding:'8px 11px',background:'#EEF4F8',border:'1px solid #AACDDC',borderRadius:9}}>
        <span style={{fontSize:11,color:'#81A6C6',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.12em'}}>Cargo</span>
        <span style={{fontSize:13,fontWeight:600,color:'#2b3b49'}}>{ship.cargo||'—'}</span>
      </div>
      {/* Weather callout */}
      {ship.weather_penalty && (
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',
          background:'#EEF4F8',border:'1px solid #AACDDC',borderRadius:9,
          fontSize:11,color:'#1a6b95',fontWeight:700}}>
          <div>
            <div>Adverse weather active</div>
            <div style={{fontWeight:400,fontSize:10,color:'#81A6C6',marginTop:1}}>+30% fuel burn rate applied to this ship</div>
          </div>
        </div>
      )}
      {/* Escort callout */}
      {ship._escorting && (
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',
          background:'#FFFAF0',border:'1px solid #D2C4B4',borderRadius:9,
          fontSize:11,color:'#92501a',fontWeight:700}}>
          <div>
            <div>Escorting {ship._escorting}</div>
            <div style={{fontWeight:400,fontSize:10,color:'#81A6C6',marginTop:1}}>Shadowing target 3 km astern</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI Fleet Advisor Panel ─────────────────────────────────────────────────────
export function AdvisorPanel({ data, loading, onRefresh }) {
  const SEV_COLOR = { critical: '#c0392b', high: '#c07c2b', medium: '#1a6b95', low: '#2e7d6e', info: '#81A6C6' };
  const ACTION_ICON = {
    reroute: '🗺', 'draw-zone': '🔷', 'send-aid': '🆘', 'fuel-transfer': '⛽',
    escort: '🛡', 'hold-position': '⚓', default: '⚡',
  };

  if (loading) return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:12,color:'#81A6C6'}}>
      <div style={{fontSize:28,animation:'spin 1.2s linear infinite'}}>⚙</div>
      <div style={{fontSize:12,fontWeight:700,letterSpacing:'0.1em'}}>ADVISOR THINKING…</div>
    </div>
  );

  if (!data) return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:14}}>
      <div style={{fontSize:36}}>🤖</div>
      <div style={{fontSize:13,fontWeight:700,color:'#2b3b49',textAlign:'center'}}>AI Fleet Advisor</div>
      <div style={{fontSize:11,color:'#81A6C6',textAlign:'center',lineHeight:1.5,maxWidth:200}}>
        Get proactive recommendations based on current fleet conditions, weather, and risk.
      </div>
      <button onClick={onRefresh} style={{
        marginTop:8, padding:'9px 20px', background:'linear-gradient(135deg,#1a6b95,#2e7d6e)',
        color:'#fff', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer',
      }}>Ask AI Advisor →</button>
    </div>
  );

  if (data.error) return (
    <div style={{padding:16,background:'#fef0f0',borderRadius:8,margin:12,fontSize:12,color:'#c0392b',fontWeight:600}}>
      ⚠ {data.error}
      <button onClick={onRefresh} style={{marginLeft:10,padding:'2px 8px',borderRadius:5,border:'1px solid #c0392b',background:'none',color:'#c0392b',cursor:'pointer',fontSize:11}}>Retry</button>
    </div>
  );

  const recs = data.recommendations || [];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:10,padding:'12px 10px'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.18em',textTransform:'uppercase',color:'#81A6C6'}}>
          {recs.length} Recommendation{recs.length !== 1 ? 's' : ''}
        </div>
        <button onClick={onRefresh} style={{
          fontSize:10, fontWeight:700, color:'#1a6b95', background:'#EEF4F8',
          border:'1px solid #AACDDC', borderRadius:5, padding:'3px 10px', cursor:'pointer',
        }}>↺ Refresh</button>
      </div>

      {/* Summary */}
      {data.summary && (
        <div style={{background:'linear-gradient(135deg,#f0f8ff,#e8f5f0)',borderRadius:10,padding:'10px 12px',border:'1px solid #cce3ef',fontSize:12,color:'#1a2b38',lineHeight:1.6}}>
          {data.summary}
        </div>
      )}

      {/* Recommendation cards */}
      {recs.length === 0 && (
        <div style={{textAlign:'center',color:'#81A6C6',fontSize:12,padding:'20px 0'}}>Fleet is stable — no actions recommended.</div>
      )}
      {recs.map((rec, i) => {
        const urgColor = SEV_COLOR[rec.urgency] || '#81A6C6';
        const icon = ACTION_ICON[rec.action_type] || ACTION_ICON.default;
        return (
          <div key={i} style={{
            background:'#fafcff', borderRadius:10, border:`1.5px solid ${urgColor}33`,
            padding:'10px 12px', display:'flex', flexDirection:'column', gap:6,
          }}>
            {/* Top row */}
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:18}}>{icon}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:800,color:'#1a2b38'}}>{rec.title || rec.action_type || 'Recommendation'}</div>
                {rec.ship_ids?.length > 0 && (
                  <div style={{fontSize:10,color:'#81A6C6',fontWeight:600}}>{rec.ship_ids.join(', ')}</div>
                )}
              </div>
              <span style={{fontSize:9,fontWeight:800,padding:'2px 8px',borderRadius:999,
                background:`${urgColor}18`,color:urgColor,border:`1px solid ${urgColor}44`,
                textTransform:'uppercase',letterSpacing:'0.1em'}}>
                {rec.urgency || 'info'}
              </span>
            </div>
            {/* Reasoning */}
            {rec.reasoning && (
              <div style={{fontSize:11,color:'#5f6b77',lineHeight:1.5}}>{rec.reasoning}</div>
            )}
            {/* Action */}
            {rec.action && (
              <div style={{fontSize:11,fontWeight:700,color:urgColor,background:`${urgColor}0d`,
                borderRadius:6,padding:'4px 8px',fontFamily:'monospace'}}>
                → {rec.action}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}// ── Captain Alerts ────────────────────────────────────────────────────────────
export function CaptainAlerts({ alerts = [], ackAlert }) {
  if (!alerts.length) return (
    <div className="panel-empty">No alerts for your vessel</div>
  );
  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {alerts.slice().sort((a,b)=>(b.severity||0)-(a.severity||0)).map(a => {
        const sev = SEV[a.severity] || SEV[3];
        return (
          <div key={a.id} style={{background:'#ffffff',border:`1px solid #D2C4B4`,
            borderLeft:`3px solid ${sev.color}`,borderRadius:10,padding:'10px 12px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:10,fontWeight:800,letterSpacing:'0.12em',color:sev.color}}>{sev.label}</span>
              <span style={{fontSize:10,color:'#81A6C6',fontWeight:700,letterSpacing:'0.1em'}}>{a.type?.toUpperCase()}</span>
            </div>
            <div style={{fontSize:12,color:'#2b3b49',marginBottom:7,lineHeight:1.45}}>{a.message}</div>
            {a.ai_extraction && (
              <div style={{display:'flex',alignItems:'flex-start',gap:7,background:'#EEF4F8',
                border:'1px solid #AACDDC',borderRadius:7,padding:'6px 9px',
                fontSize:11,color:'#1a6b95',marginBottom:7,lineHeight:1.4}}>
                <span style={{fontSize:9,fontWeight:800,background:'#81A6C6',color:'#fff',
                  borderRadius:4,padding:'2px 5px',flexShrink:0}}>AI</span>
                <span>{a.ai_extraction.incident_type} · {a.ai_extraction.injury_count??0} inj · {a.ai_extraction.immediate_needs}</span>
              </div>
            )}
            <button onClick={() => ackAlert(a.id)}
              style={{width:'100%',padding:5,borderRadius:6,border:'1px solid #D2C4B4',
                background:'#F3E3D0',color:'#5f6b77',fontSize:11,fontWeight:700,cursor:'pointer'}}>
              Acknowledge
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Captain Directives ────────────────────────────────────────────────────────
export function CaptainDirectives({ shipId }) {
  const pendingDirectives = useStore(s => s.pendingDirectives);
  const respondDirective  = useStore(s => s.respondDirective);
  const mine = pendingDirectives.filter(d => d.ship_id === shipId);

  if (!mine.length) return (
    <div className="panel-empty">
      <strong style={{fontSize:13,color:'#2b3b49'}}>No pending directives</strong>
      <span style={{fontSize:11}}>Orders from Fleet Command will appear here</span>
    </div>
  );
  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.18em',textTransform:'uppercase',color:'#c07c2b'}}>
        Pending Directives ({mine.length})
      </div>
      {mine.map(d => (
        <div key={d.id} style={{background:'#FFFAF0',border:'1px solid #D2C4B4',
          borderLeft:'3px solid #c07c2b',borderRadius:10,padding:'12px 13px'}}>
          <div style={{fontSize:14,fontWeight:800,color:'#92501a',
            textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:4}}>
            {d.type?.replace(/_/g,' ')}
          </div>
          {d.message && (
            <div style={{fontSize:12,color:'#5f6b77',marginBottom:5,lineHeight:1.45}}>{d.message}</div>
          )}
          {d.payload && Object.keys(d.payload).length > 0 && (
            <div style={{fontSize:11,color:'#81A6C6',marginBottom:8,fontFamily:'monospace',
              background:'rgba(255,255,255,0.55)',padding:'4px 8px',borderRadius:6}}>
              {Object.entries(d.payload).map(([k,v]) => {
                if (k === 'path' && Array.isArray(v)) return `path: [${v.length} waypoints]`;
                return `${k}: ${v}`;
              }).join(' · ')}
            </div>
          )}
          <div style={{fontSize:10,color:'#81A6C6',marginBottom:10}}>
            {new Date((d.created_at||0)*1000).toLocaleTimeString()}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button style={{flex:1,padding:'9px 12px',borderRadius:8,fontSize:12,fontWeight:700,
                cursor:'pointer',border:'1px solid #a8dcc5',background:'#e6f7f0',color:'#1a6b4a'}}
              onClick={() => respondDirective(d,'ACCEPT')}>Accept</button>
            <button style={{flex:1,padding:'9px 12px',borderRadius:8,fontSize:12,fontWeight:700,
                cursor:'pointer',border:'1px solid #f5b8b8',background:'#fef0f0',color:'#b91c1c'}}
              onClick={() => {
                const m = prompt('Escalation reason / distress details (optional):');
                respondDirective(d,'ESCALATE_DISTRESS',m||'');
              }}>Escalate</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Captain Distress ──────────────────────────────────────────────────────────
export function CaptainDistress({ shipId }) {
  const sendDistress      = useStore(s => s.sendDistress);
  const [input,   setInput]   = React.useState('');
  const [result,  setResult]  = React.useState(null);
  const [sending, setSending] = React.useState(false);

  async function handleSend() {
    if (!input.trim()) return;
    setSending(true);
    try {
      const r = await sendDistress(shipId, input);
      if (r._rateLimited) { setResult({ _rateLimited:true, cooldown_sec:r.cooldown_sec }); setSending(false); return; }
      setResult(r.extraction || r);
      setInput('');
    } catch {
      setResult({ issue:'Error', severity:0, impact_quantified:'Request failed — check backend' });
    }
    setSending(false);
  }

  const sevColor = result && !result._rateLimited
    ? ((result.severity||0)>=7?'#c0392b':(result.severity||0)>=4?'#c07c2b':'#2e7d6e')
    : '#1a6b95';

  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      <div style={{padding:'10px 12px',background:'#fff0f0',border:'1px solid #f5b8b8',
        borderRadius:9,fontSize:12,color:'#7f1d1d',lineHeight:1.5}}>
        <strong>Emergency broadcast.</strong> Describe your situation in plain language —
        AI extracts severity, incident type, and injury count for Fleet Command.
      </div>
      <textarea
        value={input} onChange={e => setInput(e.target.value)}
        placeholder="e.g. Engine room fire, 3 crew injured, flooding in hold 2, requesting immediate assistance…"
        rows={5}
        style={{width:'100%',background:'#fff',border:'1px solid #f5b8b8',borderRadius:9,
          color:'#7f1d1d',padding:'10px 12px',fontSize:12,resize:'vertical',outline:'none',
          lineHeight:1.55,boxSizing:'border-box',fontFamily:'inherit'}}
      />
      <button disabled={sending||!input.trim()} onClick={handleSend}
        style={{width:'100%',padding:'11px 12px',borderRadius:8,fontSize:13,fontWeight:700,
          cursor:'pointer',border:'none',
          background:sending||!input.trim()?'#FFFAF0':'#c0392b',color:'#fff',
          transition:'background 0.2s',
          boxShadow:sending||!input.trim()?'none':'0 4px 14px rgba(192,57,43,0.35)'}}>
        {sending ? 'Transmitting...' : 'Send Distress Signal'}
      </button>
      {result && (
        result._rateLimited ? (
          <div style={{padding:'10px 12px',background:'#FFFAF0',border:'1px solid #D2C4B4',
            borderRadius:9,fontSize:12,color:'#92501a',fontWeight:600}}>
             Rate limited — wait {result.cooldown_sec||30} s before sending again
          </div>
        ) : (
          <div style={{background:'#EEF4F8',border:'1px solid #AACDDC',borderRadius:11,
            padding:'12px 14px',display:'flex',flexDirection:'column',gap:7}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:2}}>
              <div style={{fontSize:10,fontWeight:800,color:'#1a6b95',letterSpacing:'0.14em',textTransform:'uppercase'}}>
                AI Analysis
              </div>
              <div style={{fontSize:14,fontWeight:800,fontFamily:'monospace',color:sevColor}}>
                Severity {result.severity ?? result.severity_score ?? '?'}/10
              </div>
            </div>
            {[
              { l:'Issue',  v: result.issue || result.incident_type },
              { l:'Impact', v: result.impact_quantified || result.immediate_needs },
              result.injury_count !== undefined ? { l:'Injuries', v: result.injury_count } : null,
              { l:'Source', v: result.source },
            ].filter(Boolean).map(({ l, v }) => v !== undefined && (
              <div key={l} style={{display:'flex',gap:8,fontSize:12,color:'#2b3b49'}}>
                <span style={{color:'#81A6C6',minWidth:60,fontWeight:700}}>{l}</span>
                <strong>{String(v)||'—'}</strong>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ── Captain S2S Operations ──────────────────────────────────────────────────
export function CaptainS2S({ shipId }) {
  const ships = useStore(s => s.ships);
  const sendDirective = useStore(s => s.sendDirective);
  const ship = ships.find(s => s.id === shipId);
  const targets = ships.filter(s => s.id !== shipId && !['arrived', 'stranded'].includes(s.status));
  
  const FUEL_RESERVE = 1000;
  const FUEL_CAPACITY = 8500;

  const [targetId, setTargetId] = React.useState('');
  const [fuelAmt, setFuelAmt] = React.useState(500);
  const [sending, setSending] = React.useState(false);
  const [feedback, setFeedback] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!targetId && targets.length > 0) setTargetId(targets[0].id);
  }, [targets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const donor = targets.find(t => t.id === targetId);

  // --- Computed validation for fuel request (donor = selected ship, recipient = captain's ship) ---
  const donorFuel = donor ? (donor.fuel || 0) : 0;
  const donorAvailable = Math.max(0, donorFuel - FUEL_RESERVE);
  const recipientRoom = ship ? Math.max(0, FUEL_CAPACITY - (ship.fuel || 0)) : 0;
  const maxTransferable = FUEL_CAPACITY;
  const donorTooLow = donorFuel < FUEL_RESERVE;
  const recipientFull = recipientRoom <= 0;

  async function issueS2S(type, payload = {}) {
    if (!donor) return;
    setSending(true); setFeedback(''); setError('');
    try {
      if (type === 'FUEL_TRANSFER') {
        // Captain is requesting fuel FROM the selected ship
        // So the selected ship (donor) is the ship_id, and captain's ship is the target
        const result = await sendDirective(donor.id, 'FUEL_TRANSFER', {
          target_ship_id: shipId,
          amount_tonnes: payload.amount_tonnes,
        });
        if (result?.result) {
          const r = result.result;
          const msg = r.was_clamped
            ? `Received ${r.actual_amount}t from ${donor.name} (requested ${r.requested_amount}t, clamped). Your fuel: ${r.target_fuel_after}t`
            : `Received ${r.actual_amount}t from ${donor.name}. Your fuel: ${r.target_fuel_after}t`;
          setFeedback(msg);
        } else {
          setFeedback(`Fuel received from ${donor.name}`);
        }
      } else if (type === 'ESCORT') {
        // Request the selected ship to escort captain's ship
        const result = await sendDirective(donor.id, 'ESCORT', { target_ship_id: shipId });
        setFeedback(`${donor.name} is now escorting your vessel`);
      } else if (type === 'MEDICAL_AID') {
        // Request the selected ship to send medical aid to captain's ship
        const result = await sendDirective(donor.id, 'MEDICAL_AID', { target_ship_id: shipId });
        setFeedback(`${donor.name} dispatched for medical aid to your vessel`);
      }
    } catch (err) {
      setError(err.message || 'Request failed');
    }
    setSending(false);
    setTimeout(() => { setFeedback(''); setError(''); }, 6000);
  }

  if (!ship) return null;

  const fuelRequestDisabled = sending || fuelAmt < 50 || !donor;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.18em',textTransform:'uppercase',color:'#1a6b95'}}>
        Fleet Assistance
      </div>

      {targets.length === 0 ? (
        <div style={{fontSize:11,color:'#81A6C6',padding:'6px 10px',background:'#FFFAF0',borderRadius:7}}>
          No other active ships available.
        </div>
      ) : (
        <>
          <select value={targetId} onChange={e => setTargetId(e.target.value)}
            style={{width:'100%',padding:'9px 12px',borderRadius:8,fontSize:13,
              border:'1px solid #AACDDC',background:'#EEF4F8',color:'#2b3b49',outline:'none'}}>
            {targets.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.status?.replace(/_/g,' ')}) — {Math.round(t.fuel||0)}t ({Math.min(100, ((t.fuel||0)/FUEL_CAPACITY)*100).toFixed(0)}%)
              </option>
            ))}
          </select>

          {donor && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
              <DataCell label="Donor Fuel" value={`${Math.round(donorFuel)}t`} warn={donorTooLow} />
              <DataCell label="Available" value={`${Math.round(donorAvailable)}t`} warn={donorAvailable <= 0} />
              <DataCell label="Your Room" value={`${Math.round(recipientRoom)}t`} warn={recipientFull} />
            </div>
          )}

          {/* Fuel Transfer (Request FROM selected ship) */}
          <div style={{background:'#f7fbfe',border:'1px solid #AACDDC',borderRadius:9,padding:'11px 13px'}}>
            <div style={{fontSize:11,fontWeight:800,color:'#1a6b95',textTransform:'uppercase',marginBottom:8}}>
              Request Fuel Transfer
            </div>

            {/* Validation warnings */}
            {donorTooLow && (
              <div style={{fontSize:11,color:'#c0392b',fontWeight:600,padding:'5px 9px',
                background:'#fef0f0',border:'1px solid #f5b8b8',borderRadius:7,marginBottom:7}}>
                ⚠ {donor?.name} only has {Math.round(donorFuel)}t — must keep {FUEL_RESERVE}t reserve
              </div>
            )}
            {recipientFull && (
              <div style={{fontSize:11,color:'#c07c2b',fontWeight:600,padding:'5px 9px',
                background:'#FFFAF0',border:'1px solid #D2C4B4',borderRadius:7,marginBottom:7}}>
                ⚠ Your ship is at max fuel capacity ({FUEL_CAPACITY}t)
              </div>
            )}

            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
              <input type="range"
                min={100} max={Math.max(100, Math.floor(maxTransferable / 100) * 100 || 100)} step={100}
                value={Math.min(fuelAmt, Math.max(100, maxTransferable))}
                onChange={e => setFuelAmt(Number(e.target.value))}
                style={{flex:1}}
              />
              <span style={{fontSize:13,fontFamily:'monospace',fontWeight:700,color:'#2b3b49',minWidth:48}}>
                {fuelAmt}t
              </span>
            </div>

            {/* Preview line */}
            {!donorTooLow && !recipientFull && donor && maxTransferable > 0 && (
              <div style={{fontSize:10,color:'#81A6C6',marginBottom:7,lineHeight:1.4}}>
                Max requestable: <strong>{Math.round(maxTransferable)}t</strong> · 
                Donor after: <strong>{Math.round(donorFuel - fuelAmt)}t</strong> · 
                Your fuel after: <strong>{Math.round((ship.fuel||0) + fuelAmt)}t</strong>
              </div>
            )}

            <button disabled={fuelRequestDisabled} onClick={() => issueS2S('FUEL_TRANSFER', { amount_tonnes: fuelAmt })}
              style={{width:'100%',padding:'9px',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',
                border:'1px solid #AACDDC',background:'#EEF4F8',color:'#1a6b95',
                opacity: fuelRequestDisabled ? 0.35 : 1, transition:'all 0.18s'}}>
              Request {fuelAmt}t from {donor?.name || '—'}
            </button>
          </div>

          {/* Other Operations */}
          <div style={{display:'flex',gap:8}}>
            <button disabled={sending} onClick={() => issueS2S('ESCORT')}
              style={{flex:1,padding:'9px',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',
                border:'1px solid #D2C4B4',background:'#FFFAF0',color:'#92501a',
                opacity: sending ? 0.4 : 1, transition:'all 0.18s'}}>
              Request Escort
            </button>
            <button disabled={sending} onClick={() => issueS2S('MEDICAL_AID')}
              style={{flex:1,padding:'9px',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',
                border:'1px solid #f5b8b8',background:'#fef0f0',color:'#b91c1c',
                opacity: sending ? 0.4 : 1, transition:'all 0.18s'}}>
              Request Medevac
            </button>
          </div>

          {feedback && (
            <div style={{fontSize:11,fontWeight:600,padding:'7px 10px',borderRadius:7,textAlign:'center',
              background:'#e6f7f0',color:'#1a6b4a',border:'1px solid #a8dcc5',lineHeight:1.4}}>
              ✓ {feedback}
            </div>
          )}

          {error && (
            <div style={{fontSize:11,fontWeight:600,padding:'7px 10px',borderRadius:7,textAlign:'center',
              background:'#fef0f0',color:'#b91c1c',border:'1px solid #f5b8b8',lineHeight:1.4}}>
              ✗ {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
