import React, { useState, useEffect } from 'react';
import { useStore } from './store';
import MapBox from './components/MapBox';
import { AlertPanel, ShipList, ShipDetail, CaptainPanel, ZonePanel, WeatherPanel,
         CaptainVitals, CaptainAlerts, CaptainDirectives, CaptainDistress, CaptainS2S,
         AdvisorPanel } from './components/Panels';
import './index.css';

const SHIPS_META = [
  { id: 'MV-1',  name: 'Aurora'  }, { id: 'MV-2',  name: 'Borealis' }, { id: 'MV-3',  name: 'Cygnus'  },
  { id: 'MV-4',  name: 'Dragon'  }, { id: 'MV-5',  name: 'Emerald'  }, { id: 'MV-6',  name: 'Falcon'  },
  { id: 'MV-7',  name: 'Gharial' }, { id: 'MV-8',  name: 'Halcyon'  }, { id: 'MV-9',  name: 'Iris'    },
  { id: 'MV-10', name: 'Jade'    }, { id: 'MV-11', name: 'Kite'     }, { id: 'MV-12', name: 'Lotus'   },
  { id: 'MV-13', name: 'Mirage'  }, { id: 'MV-14', name: 'Nova'     }, { id: 'MV-15', name: 'Orca'    },
];

// ── Landing Page ──────────────────────────────────────────────────────────────
function Landing({ onEnter }) {

  return (
    <div className="landing">
      <div className="landing__orbs" aria-hidden="true">
        <span className="orb orb--teal" />
        <span className="orb orb--amber" />
        <span className="orb orb--steel" />
      </div>
      <div className="landing__gridlines" aria-hidden="true" />

      <div className="landing__content">
        <div className="landing__badge reveal">
          <span className="badge-dot" />
          Fleetwatch Ops
        </div>

        <section className="landing__hero reveal delay-1">
          <div className="landing__eyebrow">Live Fleet Ops — Strait of Hormuz</div>
          <h1 className="landing__title">Maritime Command</h1>
          <p className="landing__subtitle">
            Track 15 ships, route around risk zones, respond to distress in real-time.
          </p>
          <div className="landing__stats">
            <div className="stat-card">
              <div className="stat-value">15</div>
              <div className="stat-label">Vessels</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">1Hz</div>
              <div className="stat-label">Updates</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">AI</div>
              <div className="stat-label">Distress NLP</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">A*</div>
              <div className="stat-label">Routing</div>
            </div>
          </div>
          <div className="landing__note">Geofencing · Proximity alerts · Weather-aware routing · 1-hr playback</div>
        </section>

        {/* ── Role cards ── */}
        <section className="landing__choices reveal delay-2">

          {/* Fleet Command card */}
          <div className="role-card" style={{ '--accent': '#81A6C6', '--accent-strong': '#6E93B3', '--accent-soft': '#FFFAF0' }}>
            <div className="role-card__icon">CMD</div>
            <div className="role-card__title">Fleet Command</div>
            <p className="role-card__desc">Oversee the entire fleet, draw restricted zones, issue directives to any ship.</p>
            <ul className="role-card__list">
              {['Live map of all 15 ships', 'Draw & delete restricted zones', 'Issue directives to captains', 'AI fleet advisor', '1-hour playback timeline'].map(f => (
                <li key={f} className="role-card__item">
                  <span className="role-card__bullet" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button onClick={() => onEnter('command', null)} className="role-card__button">
              Enter Command →
            </button>
          </div>

          {/* Ship Captain card — redesigned to show ships immediately */}
          <div className="role-card role-card--captain"
            style={{ '--accent': '#4F88A8', '--accent-strong': '#3C6F8F', '--accent-soft': '#FFFAF0' }}>
            <div className="role-card__icon">CPT</div>
            <div className="role-card__title">Ship Captain</div>
            <p className="role-card__desc">Your ship view. Receive directives from Command and send distress signals.</p>
            
            <div style={{marginTop: 20, marginBottom: 10, fontSize: 13, fontWeight: 800, color: '#3C6F8F', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
              Select Vessel to Board:
            </div>
            
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8}}>
              {SHIPS_META.map(s => (
                <button
                  key={s.id}
                  onClick={() => onEnter('captain', s.id)}
                  style={{
                    padding: '8px 4px', background: '#EEF4F8', border: '1px solid #AACDDC', 
                    borderRadius: 6, cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.background = '#3C6F8F'; e.currentTarget.style.color = '#fff'; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = '#EEF4F8'; e.currentTarget.style.color = 'inherit'; }}
                >
                  <div style={{fontSize: 10, fontWeight: 800, opacity: 0.7, marginBottom: 2}}>{s.id}</div>
                  <div style={{fontSize: 12, fontWeight: 700}}>{s.name}</div>
                </button>
              ))}
            </div>
          </div>

        </section>
      </div>
    </div>
  );
}

// ── Shared status pill ────────────────────────────────────────────────────────
function ConnPill({ connected }) {
  return (
    <span className={`app-pill ${connected ? 'app-pill--green' : 'app-pill--red'}`}>
      <span className="app-pill__dot" />
      {connected ? 'LIVE' : 'OFFLINE'}
    </span>
  );
}

// ── Command Interface ─────────────────────────────────────────────────────────
function CommandApp() {
  const selectedShipId   = useStore(s => s.selectedShipId);
  const setSelectedShipId = useStore(s => s.setSelectedShipId);
  const alerts           = useStore(s => s.alerts);
  const tick             = useStore(s => s.tick);
  const connected        = useStore(s => s.connected);
  const playbackMode     = useStore(s => s.playbackMode);
  const history          = useStore(s => s.history);
  const playbackIndex    = useStore(s => s.playbackIndex);
  const setPlaybackIndex  = useStore(s => s.setPlaybackIndex);
  const loadHistory      = useStore(s => s.loadHistory);
  const exitPlayback     = useStore(s => s.exitPlayback);
  const zones            = useStore(s => s.zones);
  
  const [rightTab, setRightTab] = useState('ship'); // 'ship' | 'zones' | 'weather' | 'advisor'
  const [advisorData, setAdvisorData] = useState(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const BACKEND = import.meta.env.DEV ? 'http://localhost:8000' : '';

  const runAdvisor = async () => {
    setAdvisorLoading(true);
    try {
      const r = await fetch(`${BACKEND}/api/advisor`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await r.json();
      setAdvisorData(data);
    } catch { setAdvisorData({ error: 'Advisor unavailable — check OPENROUTER_API_KEY' }); }
    setAdvisorLoading(false);
  };

  const unacked = alerts.filter(a => !a.acknowledged).length;

  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="app-topbar">
        <div className="app-topbar__left">
          <span className="app-logo">FLEETWATCH <span className="app-logo__sub">COMMAND</span></span>
          <span className="app-tick">TICK #{tick}</span>
        </div>
        <div className="app-topbar__right">
          {unacked > 0 && (
            <span className="app-pill app-pill--red">
              <span className="app-pill__dot" style={{ animationDuration: '0.7s' }} />
              {unacked} ALERT{unacked !== 1 ? 'S' : ''}
            </span>
          )}
          <ConnPill connected={connected} />
          <button className="app-btn app-btn--ghost" onClick={playbackMode ? exitPlayback : loadHistory}>
            {playbackMode ? 'Exit Playback' : 'Playback'}
          </button>
          <button className="app-btn app-btn--ghost" onClick={() => window.location.reload()}>← Exit</button>
        </div>
      </header>

      {/* Main 3-column layout */}
      <div className="app-body app-body--three-col">
        {/* Left: Fleet list + Alerts */}
        <aside className="app-sidebar">
          <div className="sidebar-section sidebar-section--flex">
            <div className="sidebar-section__title">Fleet Status</div>
            <div className="sidebar-section__body sidebar-section__body--scroll">
              <ShipList onSelect={setSelectedShipId} />
            </div>
          </div>
          <div className="sidebar-divider" />
          <div className="sidebar-section sidebar-section--alerts">
            <div className="sidebar-section__title">
              Alerts {unacked > 0 && <span className="sidebar-badge">{unacked}</span>}
            </div>
            <div className="sidebar-section__body sidebar-section__body--scroll">
              <AlertPanel />
            </div>
          </div>
        </aside>

        {/* Center: Map */}
        <main className="app-main">
          <MapBox isCommand={true} />
          {playbackMode && (
            <div className="playback-bar">
              <span className="playback-bar__label">PLAYBACK</span>
              <input
                type="range" min={0} max={Math.max(0, history.length - 1)}
                value={playbackIndex}
                onChange={e => setPlaybackIndex(Number(e.target.value))}
                className="playback-bar__slider"
              />
              <span className="playback-bar__time">
                {history[playbackIndex]
                  ? new Date(history[playbackIndex].timestamp * 1000).toLocaleTimeString()
                  : '--:--:--'}
              </span>
            </div>
          )}
        </main>

        {/* Right: Ship detail + Zones */}
        <aside className="app-sidebar">
          {/* Tab buttons */}
          <div style={{display:'flex',flexWrap:'wrap',borderBottom:'1px solid rgba(129, 166, 198, 0.12)',flexShrink:0}}>
            {[
              { id: 'ship',    label: 'Ship' },
              { id: 'zones',   label: `Zones${zones.length > 0 ? ` (${zones.length})` : ''}` },
              { id: 'weather', label: 'Weather' },
              { id: 'advisor', label: 'AI Advisor' },
            ].map(tab => (
              <button key={tab.id} onClick={() => { setRightTab(tab.id); if (tab.id === 'advisor' && !advisorData) runAdvisor(); }}
                style={{
                  flex:1, minWidth:'20%', padding:'10px 4px', fontSize:'10px', fontWeight:700,
                  letterSpacing:'0.08em', textTransform:'uppercase', cursor:'pointer',
                  border:'none', background:'transparent',
                  color: rightTab === tab.id ? '#81A6C6' : '#5f6b77',
                  borderBottom: rightTab === tab.id ? '2px solid #81A6C6' : 'none',
                  transition:'all 0.2s',
                }}
              >{tab.label}</button>
            ))}
          </div>
          
          {/* Tab content */}
          <div className="sidebar-section sidebar-section--flex">
            <div className="sidebar-section__title">
              {rightTab === 'ship' ? 'Ship Detail' : rightTab === 'zones' ? 'Restricted Zones' : rightTab === 'weather' ? 'Weather Systems' : 'AI Fleet Advisor'}
            </div>
            <div className="sidebar-section__body sidebar-section__body--scroll">
              {rightTab === 'ship' ? (
                <ShipDetail shipId={selectedShipId} />
              ) : rightTab === 'zones' ? (
                <ZonePanel />
              ) : rightTab === 'weather' ? (
                <WeatherPanel />
              ) : (
                <AdvisorPanel data={advisorData} loading={advisorLoading} onRefresh={runAdvisor} />
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Captain Interface ─────────────────────────────────────────────────────────
const CAP_STATUS_COLOR = {
  normal:'#2e7d6e', rerouting:'#c07c2b', distressed:'#c0392b',
  stopped:'#81A6C6', stranded:'#7b3fa0', arrived:'#1a6b95', insufficient_fuel:'#b85c00',
};

function CaptainApp({ shipId }) {
  const connected = useStore(s => s.connected);
  const ships     = useStore(s => s.ships);
  const alerts    = useStore(s => s.alerts);
  const tick      = useStore(s => s.tick);
  const ackAlert  = useStore(s => s.ackAlert);
  const ship      = ships.find(s => s.id === shipId);

  const myAlerts  = alerts.filter(a => a.ship_ids?.includes(shipId));
  const unacked   = myAlerts.filter(a => !a.acknowledged).length;
  const statusColor = CAP_STATUS_COLOR[ship?.status] || '#81A6C6';

  const [rightTab, setRightTab] = useState('directives');

  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="app-topbar">
        <div className="app-topbar__left">
          <span className="app-logo" style={{ color: statusColor }}>
            {ship ? ship.name : shipId} <span className="app-logo__sub">CAPTAIN</span>
          </span>
          <span className="app-tick">TICK #{tick}</span>
          {ship && (
            <span style={{
              fontSize:'10px', fontWeight:800, letterSpacing:'0.12em',
              textTransform:'uppercase', padding:'2px 10px', borderRadius:999,
              color: statusColor, background:`${statusColor}18`, border:`1px solid ${statusColor}33`,
            }}>
              {ship.status?.replace(/_/g,' ')}
            </span>
          )}
          {ship?.weather_penalty && (
            <span style={{fontSize:'11px',color:'#1a6b95',fontWeight:700,
              padding:'2px 9px',borderRadius:999,background:'#EEF4F8',border:'1px solid #AACDDC'}}>
              Storm +30%
            </span>
          )}
        </div>
        <div className="app-topbar__right">
          {unacked > 0 && (
            <span className="app-pill app-pill--red">
              <span className="app-pill__dot" style={{animationDuration:'0.7s'}} />
              {unacked} ALERT{unacked !== 1 ? 'S' : ''}
            </span>
          )}
          <ConnPill connected={connected} />
          <button className="app-btn app-btn--ghost" onClick={() => window.location.reload()}>← Exit</button>
        </div>
      </header>

      {/* 3-column layout */}
      <div className="app-body app-body--three-col">

        {/* Left: Ship vitals + my alerts */}
        <aside className="app-sidebar">
          <div className="sidebar-section sidebar-section--flex">
            <div className="sidebar-section__title">My Vessel</div>
            <div className="sidebar-section__body sidebar-section__body--scroll">
              <CaptainVitals ship={ship} />
            </div>
          </div>
          <div className="sidebar-divider" />
          <div className="sidebar-section sidebar-section--alerts">
            <div className="sidebar-section__title">
              My Alerts {unacked > 0 && <span className="sidebar-badge">{unacked}</span>}
            </div>
            <div className="sidebar-section__body sidebar-section__body--scroll">
              <CaptainAlerts alerts={myAlerts} ackAlert={ackAlert} />
            </div>
          </div>
        </aside>

        {/* Centre: Map — view-only (no draw controls) */}
        <main className="app-main">
          <MapBox isCommand={false} />
        </main>

        {/* Right: Directives / Distress tabs */}
        <aside className="app-sidebar">
          <div style={{display:'flex',borderBottom:'1px solid rgba(129,166,198,0.12)',flexShrink:0}}>
            {[{id:'directives',label:'Directives'},{id:'distress',label:'Distress'},{id:'s2s',label:'Fleet Ops'}].map(tab => (
              <button key={tab.id} onClick={() => setRightTab(tab.id)} style={{
                flex:1, padding:'12px 6px', fontSize:'10px', fontWeight:800,
                letterSpacing:'0.06em', textTransform:'uppercase', cursor:'pointer',
                border:'none', background:'transparent',
                color: rightTab===tab.id ? '#81A6C6' : '#5f6b77',
                borderBottom: rightTab===tab.id ? '2px solid #81A6C6' : 'none',
                transition:'all 0.2s', whiteSpace:'nowrap',
              }}>{tab.label}</button>
            ))}
          </div>
          <div className="sidebar-section sidebar-section--flex">
            <div className="sidebar-section__body sidebar-section__body--scroll">
              {rightTab === 'directives' && <CaptainDirectives shipId={shipId} />}
              {rightTab === 'distress' && <CaptainDistress shipId={shipId} />}
              {rightTab === 's2s' && <CaptainS2S shipId={shipId} />}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const initSocket = useStore(s => s.initSocket);
  const setRole    = useStore(s => s.setRole);

  useEffect(() => {
    initSocket();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) {
    return (
      <Landing
        onEnter={(role, shipId) => {
          setRole(role, shipId);
          setSession({ role, captainShipId: shipId });
          if (shipId) {
            useStore.getState().setSelectedShipId(shipId);
          }
        }}
      />
    );
  }
  if (session.role === 'command') return <CommandApp />;
  return <CaptainApp shipId={session.captainShipId} />;
}
