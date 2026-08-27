// ═══════════════════════════════════════════════════════════════
// SECTION 1 — CONSTANTS & STATE
// ═══════════════════════════════════════════════════════════════
const AF_BASE   = 'https://v3.football.api-sports.io';
// ↓ Paste your Cloudflare Worker URL here after deployment (see banits-worker.js for steps)
// When set, ALL API calls route through the worker — no CORS issues, works on any device,
// and your API-Football key never has to leave the Worker (it's read server-side from the
// encrypted API_KEY env var). Do NOT put a real API-Football key in this file — this file
// is served publicly by GitHub Pages and a key here is visible to anyone via view-source.
// When empty, fixture/WC calls fall back to hitting API-Football directly and will fail
// without a key — that path is dev-only and intentionally not wired up with a secret here.
const WORKER_URL = 'https://fancy-shadow-6d48.nicholas-bennett0506.workers.dev';

// Resolve the base URL and headers for any API call
function _apiBase(){ return WORKER_URL || AF_BASE; }
function _apiHdrs(){
  if(WORKER_URL) return {};
  console.warn('[Banits] WORKER_URL is unset — direct API-Football calls need a key (never hardcode one here) and /players endpoints will be CORS-blocked regardless.');
  return {};
}
const LIVE_STATUSES = new Set(['1H','HT','2H','ET','BT','P','LIVE']);
const FINAL_STATUSES = new Set(['FT','AET','PEN','AWD','WO']);

let _dayOffset   = 0;         // offset from today
let _activeId    = null;      // currently open fixture ID
let _leaguesOpen = false;     // true while the Leagues (standings) tab is open — gates the landing-page background poll
let _activeClubId  = null;    // currently open club-page team ID — see SECTION 15c
let _clubSearchOpen = false;  // true while the Club Search tab is open — same gating role as _leaguesOpen
let _clubReturnTo  = 'search'; // where the club page's Back button goes — 'search' | 'leagues'
let _matchReturnTo = 'home';   // where the match view's Back button goes — 'home' | 'club'
let _matchReturnClubId = null; // which club to return to when _matchReturnTo==='club'
let _refreshTmr  = null;      // live-refresh interval
let _callCount   = 0;
let _fixturesCache = [];      // cached for landing page
let _landingErrMsg = null;    // set when the current day's fixture load has genuinely failed
let _fixturesFetchDone = false; // true once the first fixture fetch for the current day has resolved (success or confirmed-empty) — distinguishes "still loading" from "loaded, nothing here"
let _fixtureDetailCache = new Map(); // keyed by fid — avoids repeat /fixtures?id= calls
let _saHomePlayers = [];      // season analysis results — for pitch overlay
let _saAwayPlayers = [];
let _pitchStatMode = 'cards'; // 'cards' | 'fouls' | 'tackles'
let _lastFx=null,_lastHt=null,_lastAt=null; // cached for re-render on toggle
let _currentRefFactor = 1;   // multiplier applied to the foul-based half of cardProb()'s λ — see getRefereeFactor()
let _currentRefMeta = null;  // {factor, sample, avgCards, leagueAvgCards} | null — for UI disclosure
let _currentInjuries = new Map(); // playerId → {type,reason} for the currently-open fixture — see getInjuries()

// ═══════════════════════════════════════════════════════════════
// SECTION 2 — TEAM COLOURS
// ═══════════════════════════════════════════════════════════════
const TC = {
  // English clubs
  'Arsenal':{c:'#ff4458',a:'ARS'},'Chelsea':{c:'#5096e3',a:'CHE'},
  'Liverpool':{c:'#e84040',a:'LIV'},'Manchester City':{c:'#5fc4e8',a:'MCI'},
  'Manchester United':{c:'#e05050',a:'MUN'},'Tottenham Hotspur':{c:'#7cb3f5',a:'TOT'},
  'Tottenham':{c:'#7cb3f5',a:'TOT'},'Newcastle United':{c:'#8bc4f7',a:'NEW'},
  'Brighton':{c:'#4a8fd4',a:'BHA'},'Aston Villa':{c:'#9d2449',a:'AVL'},
  'West Ham':{c:'#8b1e4b',a:'WHU'},'Everton':{c:'#3a6ec0',a:'EVE'},
  'Fulham':{c:'#cc3030',a:'FUL'},'Brentford':{c:'#e84040',a:'BRE'},
  'Crystal Palace':{c:'#1b458f',a:'CRY'},'Wolverhampton Wanderers':{c:'#f5a623',a:'WOL'},
  'Wolves':{c:'#f5a623',a:'WOL'},'Nottingham Forest':{c:'#e84040',a:'NFO'},
  'Leicester City':{c:'#003090',a:'LEI'},'Ipswich Town':{c:'#3a6ec0',a:'IPS'},
  'Celtic':{c:'#16a34a',a:'CEL'},'Rangers':{c:'#002f6c',a:'RAN'},
  // Spanish
  'Barcelona':{c:'#3d5fa1',a:'BAR'},'Real Madrid':{c:'#d4af37',a:'RMA'},
  'Atletico Madrid':{c:'#d03030',a:'ATM'},'Sevilla':{c:'#e84040',a:'SEV'},
  'Villarreal':{c:'#e5d425',a:'VIL'},'Real Sociedad':{c:'#3a6ec0',a:'RSO'},
  // German
  'Bayern Munich':{c:'#DC143C',a:'BAY'},'Borussia Dortmund':{c:'#f5df00',a:'BVB'},
  'RB Leipzig':{c:'#e84040',a:'RBL'},'Bayer Leverkusen':{c:'#e84040',a:'B04'},
  // Italian
  'Juventus':{c:'#a0a0a0',a:'JUV'},'AC Milan':{c:'#d03030',a:'ACM'},
  'Inter Milan':{c:'#3d5fa1',a:'INT'},'Inter':{c:'#3d5fa1',a:'INT'},
  'Napoli':{c:'#3a6ec0',a:'NAP'},'AS Roma':{c:'#f5a623',a:'ROM'},
  // French
  'PSG':{c:'#3d5fa1',a:'PSG'},'Paris Saint Germain':{c:'#3d5fa1',a:'PSG'},
  'Marseille':{c:'#5fc4e8',a:'OM'},'Monaco':{c:'#e84040',a:'MON'},
  // Dutch
  'Ajax':{c:'#e84040',a:'AJX'},'PSV Eindhoven':{c:'#e84040',a:'PSV'},
  // Portuguese
  'Benfica':{c:'#e84040',a:'BEN'},'Porto':{c:'#4a8fd4',a:'POR'},'Sporting CP':{c:'#16a34a',a:'SCP'},
  // National teams
  'England':{c:'#5096e3',a:'ENG'},'France':{c:'#4a6ec0',a:'FRA'},
  'Spain':{c:'#e84040',a:'ESP'},'Germany':{c:'#c8c8c8',a:'GER'},
  'Italy':{c:'#4a6ec0',a:'ITA'},'Portugal':{c:'#e84040',a:'POR'},
  'Brazil':{c:'#e5d425',a:'BRA'},'Argentina':{c:'#6cb4e8',a:'ARG'},
  'Netherlands':{c:'#ff8c00',a:'NED'},'Belgium':{c:'#e84040',a:'BEL'},
  'Croatia':{c:'#5096e3',a:'CRO'},'Poland':{c:'#e84040',a:'POL'},
  'Switzerland':{c:'#e84040',a:'SUI'},'Denmark':{c:'#e84040',a:'DEN'},
  'Sweden':{c:'#e5d425',a:'SWE'},'Norway':{c:'#e84040',a:'NOR'},
  'Wales':{c:'#e84040',a:'WAL'},'Scotland':{c:'#4a6ec0',a:'SCO'},
  'Turkey':{c:'#e84040',a:'TUR'},'Türkiye':{c:'#e84040',a:'TUR'},
  'Austria':{c:'#e84040',a:'AUT'},'Hungary':{c:'#16a34a',a:'HUN'},
  'Czech Republic':{c:'#4a6ec0',a:'CZE'},'Slovakia':{c:'#4a6ec0',a:'SVK'},
  'Slovenia':{c:'#4a6ec0',a:'SVN'},'Serbia':{c:'#e84040',a:'SRB'},
  'Albania':{c:'#e84040',a:'ALB'},'North Macedonia':{c:'#e84040',a:'MKD'},
  'Ukraine':{c:'#e5d425',a:'UKR'},'Romania':{c:'#e84040',a:'ROU'},
  'Ghana':{c:'#e5d425',a:'GHA'},'Senegal':{c:'#16a34a',a:'SEN'},
  'Morocco':{c:'#e84040',a:'MAR'},'Nigeria':{c:'#16a34a',a:'NGA'},
  'Ivory Coast':{c:'#ff8c00',a:'CIV'},"Côte d'Ivoire":{c:'#ff8c00',a:'CIV'},
  'Tunisia':{c:'#e84040',a:'TUN'},'Cameroon':{c:'#16a34a',a:'CMR'},
  'Egypt':{c:'#e84040',a:'EGY'},'Algeria':{c:'#16a34a',a:'ALG'},
  'South Africa':{c:'#16a34a',a:'RSA'},'South Korea':{c:'#e84040',a:'KOR'},
  'Japan':{c:'#4a6ec0',a:'JPN'},'Saudi Arabia':{c:'#16a34a',a:'KSA'},
  'Australia':{c:'#e5d425',a:'AUS'},'Iran':{c:'#16a34a',a:'IRN'},
  'Qatar':{c:'#FF5577',a:'QAT'},'Iraq':{c:'#16a34a',a:'IRQ'},
  'USA':{c:'#4a6ec0',a:'USA'},'United States':{c:'#4a6ec0',a:'USA'},
  'Mexico':{c:'#16a34a',a:'MEX'},'Canada':{c:'#e84040',a:'CAN'},
  'Costa Rica':{c:'#e84040',a:'CRC'},'Panama':{c:'#e84040',a:'PAN'},
  'Colombia':{c:'#e5d425',a:'COL'},'Uruguay':{c:'#5fc4e8',a:'URU'},
  'Ecuador':{c:'#e5d425',a:'ECU'},'Chile':{c:'#e84040',a:'CHI'},
  'Peru':{c:'#e84040',a:'PER'},'Bolivia':{c:'#16a34a',a:'BOL'},
  'Venezuela':{c:'#e5d425',a:'VEN'},'Paraguay':{c:'#e84040',a:'PAR'},
  'Montenegro':{c:'#E63946',a:'MNE'},'Bulgaria':{c:'#16a34a',a:'BUL'},
  'Malta':{c:'#e84040',a:'MLT'},'Jordan':{c:'#e84040',a:'JOR'},
  'Uzbekistan':{c:'#5fc4e8',a:'UZB'},'Kazakhstan':{c:'#e5d425',a:'KAZ'},
};
const FB_COLS=['#60a5fa','#f87171','#34d399','#fbbf24','#a78bfa','#fb923c','#38bdf8','#f472b6'];

function tinfo(name=''){
  const direct=TC[name]; if(direct)return direct;
  for(const[k,v]of Object.entries(TC)){if(name.includes(k)||k.includes(name))return v;}
  let h=0;for(const c of name)h=(h*31+c.charCodeAt(0))&0xfffffff;
  const words=name.trim().split(/\s+/);
  const abbr=words.length>=2?words.map(w=>w[0]).join('').slice(0,3).toUpperCase():name.slice(0,3).toUpperCase();
  return{c:FB_COLS[h%FB_COLS.length],a:abbr};
}

// Render a team badge <img> from API-Football's CDN. If the image fails to load
// (some lower-tier teams have no logo), it's removed so layout doesn't break —
// the team's coloured abbreviation/name remains the fallback.
function badge(logoUrl, size='sm', alt=''){
  // Build abbreviated fallback text (e.g. "USA", "BRA", "Man Utd" → "MU")
  const abbr = alt ? alt.split(/\s+/).map(w=>w[0]).join('').slice(0,3).toUpperCase() : '';
  const fallbackHtml = abbr
    ? `<span class="badge-fb badge-${size}" title="${alt}">${abbr}</span>`
    : '';
  if(!logoUrl) return fallbackHtml;
  // onerror replaces with coloured abbreviation rather than just removing
  const errReplace = abbr
    ? `this.outerHTML='<span class=\\'badge-fb badge-${size}\\' title=\\'${alt.replace(/'/g,'')}\\' >${abbr}</span>'`
    : 'this.remove()';
  return`<img src="${logoUrl}" alt="${alt}" class="badge-${size}" loading="lazy" onerror="${errReplace}">`;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 3 — UTILITIES
// ═══════════════════════════════════════════════════════════════
function isoDate(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function selDate(){const d=new Date();d.setDate(d.getDate()+_dayOffset);return d}
function dayLabel(d){
  const ds=isoDate(d),ts=isoDate(new Date()),tmrs=isoDate(new Date(Date.now()+864e5),),yests=isoDate(new Date(Date.now()-864e5));
  if(ds===ts)return'Today';if(ds===tmrs)return'Tomorrow';if(ds===yests)return'Yesterday';
  return d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
}
function fmtTime(dateStr){return new Date(dateStr).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'})}
function isLive(st){return LIVE_STATUSES.has(st)}
function isFinal(st){return FINAL_STATUSES.has(st)}
function statusDisp(f){
  const st=f.fixture.status;
  if(isLive(st.short))return st.short==='HT'?'HT':`${st.elapsed}'`;
  if(isFinal(st.short))return'FT';
  return fmtTime(f.fixture.date);
}
function probColor(p){return p>=30?'hi':p>=15?'md':'lo'}
function probBarColor(p){return p>=30?'var(--high)':p>=15?'var(--med)':'var(--low)'}
// "1st"/"2nd"/"3rd"/"4th"… — used for club-page table position (SECTION 15c)
function ordinal(n){
  const s=['th','st','nd','rd'], v=n%100;
  return n+(s[(v-20)%10]||s[v]||s[0]);
}

// ── Fixture sidebar whitelist ────────────────────────────────
// 2026-08-23: narrowed from "any adult competition in ~55 European
// countries" (top AND second divisions, every domestic cup, every country
// from England to Kazakhstan) down to an explicit whitelist of the specific
// leagues actually wanted — the old, broad EURO_COUNTRIES-based filter is
// why a single day's fixture fetch could contain ~700 games even though the
// dashboard only ever needed a handful of them. This constant is now the
// ONLY thing that decides what shows in the sidebar, the landing grid, and
// what the results panel bothers batch-fetching events for — narrower here
// means less pulled and processed everywhere downstream. Add/remove IDs
// here to change what's tracked; league IDs are API-Football's, reused from
// MAIN_LEAGUE_IDS below.
// 2026-08-25: added the FA Cup (45) and League Cup (48) per explicit user
// request — both already had a LEAGUE_RANK entry (8/9) from the original
// 2026-08-23 filtering work, so sort order needed no change, only the
// whitelist itself. These are single-table-less knockout cups, so they're
// deliberately NOT added to LEAGUE_META (the League Tables tab/Club Search
// index, both standings-based — a cup has no league table to show).
const TRACKED_LEAGUES = new Set([
  39,   // England — Premier League
  40,   // England — Championship
  41,   // England — League One
  42,   // England — League Two
  45,   // England — FA Cup
  48,   // England — League Cup (Carabao Cup)
  61,   // France — Ligue 1
  140,  // Spain — La Liga
  78,   // Germany — Bundesliga
  94,   // Portugal — Primeira Liga
  135,  // Italy — Serie A
]);

// European club competition IDs — kept alongside TRACKED_LEAGUES (not
// replaced by it) since these mix clubs from many different domestic
// leagues into one pan-European fixture; user confirmed keeping them.
const EURO_CUPS = new Set([2,3,848]); // UCL, UEL, UECL

// Youth pattern — filter out under-age fixtures. Effectively a no-op now
// that TRACKED_LEAGUES only lists senior top/second-tier competitions, but
// harmless to keep as a defensive check against odd API data.
const YOUTH_RE = /\bU-?1[3-9]\b|\bU-?2[01]\b|Under.?1[3-9]|Under.?2[01]|\bYouth\b|\bReserves?\b|\bB Team\b/i;

// League ranking: English leagues get top priority, then European big leagues, then rest
const LEAGUE_RANK = {
  39:1, 40:2, 41:3, 42:4, 45:8, 48:9,   // England: PL, Championship, L1, L2, FA Cup, League Cup
  2:10, 3:11, 848:12,                     // UCL, UEL, UECL
  140:20, 78:21, 135:22, 61:23,           // La Liga, Bundesliga, Serie A, Ligue 1
  141:30, 79:31, 136:32, 62:33,           // 2nd tiers: Spain, Germany, Italy, France
  88:40, 94:41, 144:42, 179:43, 203:44,  // Eredivisie, Primeira Liga, Belgium, Scotland, Turkey
};

// Renamed from isEuroAdult() — that name described the old, much broader
// "any adult competition in Europe" behavior. This now means exactly what
// it says: is this fixture in one of the 9 tracked domestic leagues (or one
// of the 3 kept continental cups)?
function isTrackedLeague(f){
  const lg = f.league?.name||'', h = f.teams?.home?.name||'', a = f.teams?.away?.name||'';
  if(EURO_CUPS.has(f.league?.id)) return true;
  if(!TRACKED_LEAGUES.has(f.league?.id)) return false;
  if(YOUTH_RE.test(lg)||YOUTH_RE.test(h)||YOUTH_RE.test(a)) return false;
  return true;
}

function leagueSort(g){
  const r = LEAGUE_RANK[g.id];
  if(r) return r;
  // English leagues not in map: still before other countries
  if(g.country==='England') return 15;
  // Other European: sort by country name then league name. Guard against a
  // missing/null country (seen on some international competitions) so a
  // single odd fixture can't throw here and silently freeze the whole
  // fixture list mid-render.
  const country = g.country || '';
  const name = g.name || '';
  return 100 + country.charCodeAt(0)*10 + name.charCodeAt(0);
}

// International league IDs — used to route Analysis tab to club-stat fetching
const INTL_LEAGUES = new Set([1,4,5,6,7,8,9,10,26,29,30,31,32,33,34]);

// Primary domestic league IDs — these are preferred over cups when sorting stats
const MAIN_LEAGUE_IDS = new Set([
  39,40,41,42,        // England: PL, Championship, L1, L2
  140,141,            // Spain: La Liga, Segunda
  78,79,              // Germany: Bundesliga, 2. Bundesliga
  135,136,            // Italy: Serie A, Serie B
  61,62,              // France: Ligue 1, Ligue 2
  88,89,              // Netherlands: Eredivisie, Eerste Divisie
  94,95,              // Portugal: Primeira, Segunda
  144,145,            // Belgium: Pro League
  179,180,            // Scotland: Premiership, Championship
  203,                // Turkey: Süper Lig
  197,                // Greece: Super League
  235,                // Russia: Premier League
  106,                // Poland: Ekstraklasa
  207,                // Switzerland: Super League
  119,103,113,        // Denmark, Norway, Sweden
]);

let _showAllLeagues = false;

// ── Season data mode ──────────────────────────────────────────
// '2025' = 2025/26 season only (strict — no silent fallback to another season)
// '2026' = 2026/27 season only (strict — same)
// 'both' = blend both seasons together (minutes-weighted combine) for a
//          bigger, steadier sample — most useful early in a new season when
//          '2026' alone barely has any appearances yet.
let _seasonMode = (()=>{
  try{
    const v = localStorage.getItem('banits_season');
    return (v==='2025'||v==='2026'||v==='both') ? v : '2025';
  }catch(e){return'2025';}
})();

// Returns a single definite season year for spots that need exactly one
// (the Leagues tab, squad-loading labels) — 'both' has no single season of
// its own, so it resolves to the current in-progress club season.
function numericSeason(){
  return _seasonMode==='both' ? lastClubSeason() : parseInt(_seasonMode,10);
}

function seasonChainFromMode(){
  // _seasonMode is the API season year directly ('2025' or '2026'); intl
  // (national-team) code paths don't have a blended mode, so 'both' falls
  // back to the current club season here too — see numericSeason().
  return [numericSeason()];
}

function setSeasonMode(mode){
  if(mode!=='2025'&&mode!=='2026'&&mode!=='both') return; // ignore anything unexpected
  _seasonMode = mode;
  try{ localStorage.setItem('banits_season', mode); }catch(e){}
  document.querySelectorAll('.stog-btn').forEach(b=>b.classList.remove('on'));
  document.getElementById('stog-'+mode)?.classList.add('on');
  // Re-run analysis if a match is open.
  // Do NOT clear _playerStatsCache — keys are ${id}_${season} so seasons don't collide.
  // Clearing it forces 22+ re-fetches on every toggle which causes rate limits.
  if(_activeId && _lastFx){
    _saHomePlayers=[]; _saAwayPlayers=[];
    loadSeasonAnalysis(_lastFx.teams.home.id,_lastFx.teams.away.id,_lastFx,_lastHt,_lastAt);
  }
  if(_leaguesOpen) loadLeagueStandings(_activeLeagueId);
  // The club index is keyed off numericSeason() at build time (see
  // buildClubIndex()), so a season-mode switch can leave it holding the
  // wrong season's standings/rank entries. Drop it and let the next
  // buildClubIndex() call rebuild for the new season; if a club page is
  // open right now, refresh it immediately rather than leaving it showing
  // stale-season data until the user happens to navigate away and back.
  _clubIndex = null; _clubIndexPromise = null;
  if(_activeClubId) loadClubPage(_activeClubId);
}

// ── Persistent (localStorage) cache — season-aware TTL ──────────
// A season that's fully in the past never changes again — API-Football's
// record of a completed season (results, standings, player totals) is
// immutable — so completed-season entries can be kept effectively
// indefinitely (long TTL). The CURRENT season is still being played, so its
// numbers update after every matchday and need a much shorter TTL. This one
// helper backs every persisted cache in the app (player stats, standings,
// finished fixtures) so that distinction is applied consistently everywhere
// instead of each cache re-deciding its own TTL.
const LS_TTL_CURRENT  = 86400000;        // 24h — current season, updates after each matchday
const LS_TTL_COMPLETE = 365*86400000;    // 365 days — finished season, nothing left to change

function isSeasonComplete(season){
  return season < lastClubSeason();
}
function lsTtlForSeason(season){
  return isSeasonComplete(season) ? LS_TTL_COMPLETE : LS_TTL_CURRENT;
}
function lsGet(key){
  try{
    const raw=localStorage.getItem(key);
    if(!raw) return null;
    const {t,ttl,d}=JSON.parse(raw);
    if(Date.now()-t < ttl) return d;
    localStorage.removeItem(key); // expired
  }catch(e){}
  return null;
}
function lsSet(key,d,ttl){
  try{ localStorage.setItem(key, JSON.stringify({t:Date.now(),ttl,d})); }
  catch(e){ /* quota exceeded or storage disabled — persistence is a bonus, never load-bearing */ }
}

// ── League filter ─────────────────────────────────────────────
let _leagueFilter = null; // null = show all European

// ── Favourite teams (watchlist) ─────────────────────────────────
// Persisted client-side only (localStorage) — id → team name, so the
// landing page can label a "Your teams" section without an extra lookup.
let _favTeams = (()=>{
  try{ return new Map(JSON.parse(localStorage.getItem('banits_fav_teams')||'[]')); }
  catch(e){ return new Map(); }
})();
function _saveFavTeams(){ try{ localStorage.setItem('banits_fav_teams', JSON.stringify([..._favTeams])); }catch(e){} }
function toggleFavTeam(id, name){
  if(!id) return;
  if(_favTeams.has(id)) _favTeams.delete(id); else _favTeams.set(id, name||'');
  _saveFavTeams();
  // Re-render whatever's currently visible so the star updates immediately.
  if(_activeId && _lastFx && _lastHt && _lastAt){
    const hdr = document.getElementById('mv-hdr');
    if(hdr) hdr.innerHTML = buildHeader(_lastFx, _lastHt, _lastAt);
  }
  renderLanding();
}
// Small star toggle rendered next to a team name — favourites are teams
// only (not players) for now; role="button" + the shared _kbActivate
// keydown handler make it keyboard-operable like the app's other
// onclick-only controls.
function favStarBtn(teamId, teamName){
  if(!teamId) return '';
  const isFav = _favTeams.has(teamId);
  const safeName = (teamName||'').replace(/'/g,"\\'");
  return `<i class="ti ${isFav?'ti-star-filled':'ti-star'} fav-star${isFav?' on':''}" onclick="event.stopPropagation();toggleFavTeam(${teamId},'${safeName}')" title="${isFav?'Remove from your teams':'Add to your teams'}" role="button" tabindex="0" onkeydown="_kbActivate(event)"></i>`;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 4 — API LAYER
// ═══════════════════════════════════════════════════════════════
// afFetch() used to collapse every failure mode (real 429, auth rejection,
// upstream 5xx, a plain 404, a CORS/network exception, a non-rate-limit
// API-Football error) into an identical `null`/`'429'` return — so any
// failure at all surfaced to the user as "API rate limit hit", even when the
// actual cause was e.g. an invalid API key. _lastAfError records what
// genuinely happened on the most recent failed call so callers can show an
// accurate message; it's cleared on the next successful call.
//
// 2026-08-23 fix: _lastAfError is GLOBAL and shared by every in-flight call.
// That was always slightly racy, but harmless while every afFetch() call ran
// close to serially. Now that real concurrency is in play (SECTION 7b), an
// unrelated background call finishing at the wrong moment can stomp this
// global between another call's own await resolving and it reading the
// error — e.g. a harmless head-to-head lookup failing in the background and
// overwriting the message shown for why the ENTIRE match failed to load,
// even though the fixture-detail call itself failed for a different reason
// entirely. _afFetchCore() below returns the error alongside the data from
// the exact same call — immune to that race — and afFetchErr() exposes it
// for the couple of call sites that show a per-call failure message to the
// user; afFetch() keeps writing the shared global too, for the many other
// call sites that only care about the data and never show a message.
let _lastAfError = null; // {kind, detail} | null

async function _afFetchCore(path){
  // Direct API call for fixture/WC/standings data.
  if(path.startsWith('/players') && path.includes('search=')) return {data:null, error:null};
  // Player team queries use no-store so season changes always fetch fresh data
  const cacheMode = path.startsWith('/players?team=') ? 'no-store' : 'default';
  return queueAfCall(async()=>{
    try{
      _callCount++;
      document.getElementById('sb-calls').textContent=`API calls: ${_callCount}`;
      const r=await fetch(_apiBase()+path,{headers:_apiHdrs(), cache:cacheMode});
      // Plan auto-detection was previously wired only into afFetchRaw() — the
      // secondary fetch path used by a handful of player-stat calls — so it
      // essentially never fired, since afFetch() (this function) carries
      // nearly all real API traffic (fixtures, predictions, odds, standings,
      // h2h, form, referee, calibration). That meant the rate limiter stayed
      // pinned at its conservative default pacing for the whole session
      // regardless of the account's actual plan. Call it here too so real
      // traffic actually benefits from the higher limit once headers reveal it.
      _detectPlanFromHeaders(r.headers);
      if(!r.ok){
        if(r.status===429){
          return {data:'429', error:{kind:'rate-limit', detail:'HTTP 429'}};
        }
        if(r.status===401||r.status===403){
          return {data:null, error:{kind:'auth', detail:`HTTP ${r.status}`}};
        }
        return {data:null, error:{kind:'http', detail:`HTTP ${r.status}`}};
      }
      const d=await r.json();
      if(d.errors&&Object.keys(d.errors).length){
        if(d.errors.rateLimit||d.errors['rate-limit']){
          // Rate limit in body — back off 1s then signal as 429 for retry
          await new Promise(res=>setTimeout(res,1000));
          return {data:'429', error:{kind:'rate-limit', detail:'rate limit reported in response body'}};
        }
        console.warn('[AF]',d.errors);
        return {data:null, error:{kind:'api-error', detail:JSON.stringify(d.errors).slice(0,200)}};
      }
      return {data:d, error:null};
    }catch(e){
      console.warn('[AF]',e.message);
      return {data:null, error:{kind:'network', detail:e.message}};
    }
  });
}

async function afFetch(path){
  const {data,error}=await _afFetchCore(path);
  _lastAfError=error; // preserved for callers that read the shared global directly
  return data;
}

// Like afFetch(), but returns the error alongside the data from this exact
// call instead of relying on the shared _lastAfError global — use this at
// any call site that shows a per-call failure message to the user, so a
// concurrent unrelated call can't stomp it first. See note above _lastAfError.
async function afFetchErr(path){
  return _afFetchCore(path);
}

// Turns an af error into a message that actually names the cause, instead
// of always blaming a rate limit regardless of what happened. Pass the error
// explicitly (from afFetchErr) where a per-call message is shown; falls back
// to the shared global for older call sites that don't.
function afFailureMessage(prefix, err){
  const e = err!==undefined ? err : _lastAfError;
  if(!e) return `${prefix} — unknown error. Wait a moment and try again.`;
  switch(e.kind){
    case 'rate-limit':
      return `${prefix} — API rate limit hit (${e.detail}). Wait a moment and try again.`;
    case 'auth':
      return `${prefix} — API key rejected (${e.detail}). Check your API key and the Cloudflare Worker's API_KEY variable — it may be missing, wrong, or not yet redeployed.`;
    case 'http':
      return `${prefix} — the API/Worker returned ${e.detail}. This is not a rate limit; try again shortly or check the Worker's logs.`;
    case 'api-error':
      return `${prefix} — upstream returned an error: ${e.detail}`;
    case 'network':
      return `${prefix} — network error (${e.detail}). Check your connection or that the Worker URL is reachable.`;
    default:
      return `${prefix} — unknown error. Wait a moment and try again.`;
  }
}

// Shared "Retry" button markup for failure states.
function retryBtn(label, onclickCode){
  return`<button onclick="${onclickCode}" style="background:var(--card2);border:1px solid var(--border2);color:var(--text);font-size:11px;padding:7px 16px;border-radius:6px;cursor:pointer;margin-top:10px">
    <i class="ti ti-refresh" style="font-size:11px;margin-right:4px"></i>${label}
  </button>`;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 4b — REFEREE TENDENCY
// ═══════════════════════════════════════════════════════════════
// API-Football v3 has no "stats by referee" endpoint and /fixtures can't be
// filtered by referee — so this is built from the league's own
// finished-fixture list (one call, edge-cached 6h same as any other
// non-live endpoint), filtered client-side to matches this referee took
// charge of this season, then a capped number of those fixtures' card
// events are pulled to get an actual average cards/match for this referee
// vs a same-size baseline sample from the rest of the league.
//
// Safeguards (all exist so this can never make a prediction WORSE or
// silently wrong, only sometimes a no-op):
//  - REF_SAMPLE_CAP bounds how many extra fixture-detail calls this can
//    ever cost (they go through the same queueAfCall concurrency limiter
//    and circuit breaker as every other call, so a bad case degrades
//    gracefully rather than hammering the API)
//  - REF_MIN_SAMPLE: below this many matches by the referee this season,
//    the factor stays exactly 1 (no adjustment) rather than extrapolating
//    from 1-2 games
//  - factor is clamped to [REF_FACTOR_MIN, REF_FACTOR_MAX] so a small,
//    noisy sample can't distort the model
//  - any failure (network, malformed data, name-matching finding nothing)
//    also just leaves the factor at 1 — the exact same number the model
//    used before this feature existed. Never blocks or breaks the rest of
//    the page; loadSeasonAnalysis awaits this once, up front, then every
//    cardProb() call during that load already reflects the result.
const REF_SAMPLE_CAP  = 8;
const REF_MIN_SAMPLE  = 3;
// 2026-08-23: shared by loadMatchContext()'s match-view mini table AND the
// Leagues tab's full table (see SECTION — LEAGUES VIEW below) — previously
// each fetched /standings independently, so opening a Premier League match
// and then browsing to Leagues > Premier League re-fetched the exact same
// data. One cache, keyed by league+season, serves both. Standings are
// already cached 6h at the Cloudflare Worker's edge (they don't change
// intra-day outside of live match minutes), so an in-memory session cache
// here is a safe, cheap addition on top of that.
// Injuries/suspensions for a fixture — lets the Analysis tab badge a player
// as unavailable instead of confidently showing them a card probability
// they'll never get a chance to earn. One call per fixture
// (/injuries?fixture=X), edge-cached 6h at the Worker like any other
// non-live lookup (no worker change needed), and every API-Football plan
// includes this endpoint (confirmed 2026-08-25 research) so it never
// depends on plan tier. Failures resolve to an empty map, same
// fail-safe shape as getRefereeFactor() — a missing/errored injuries call
// just means no badges show, never a broken match view.
const _injuriesCache = new Map(); // fixtureId → Map<playerId,{type,reason}>
async function getInjuries(fid){
  if(!fid) return new Map();
  if(_injuriesCache.has(fid)) return _injuriesCache.get(fid);
  const map = new Map();
  try{
    const r = await afFetch(`/injuries?fixture=${fid}`);
    for(const entry of (r?.response||[])){
      const pid = entry?.player?.id;
      if(pid==null) continue;
      // API-Football nests type/reason under `player`; fall back to
      // top-level fields defensively in case that shape shifts.
      map.set(pid, {
        type: entry?.player?.type || entry?.type || 'Missing Fixture',
        reason: entry?.player?.reason || entry?.reason || null,
      });
    }
  }catch(e){ /* non-fatal — see comment above */ }
  _injuriesCache.set(fid, map);
  return map;
}

const _standingsCache = new Map(); // `${leagueId}_${season}` → row array | null (in-memory, this session only)
async function getStandingsTable(leagueId, season){
  if(!leagueId || !season) return null;
  const key = `${leagueId}_${season}`;
  if(_standingsCache.has(key)) return _standingsCache.get(key);
  // Also check localStorage — a completed season's table (e.g. 25/26 once
  // it's over) never changes again, so this survives across browser
  // sessions/reloads too, not just this tab's lifetime. See lsTtlForSeason().
  const lsKey = 'banits_st_'+key;
  const persisted = lsGet(lsKey);
  if(persisted!==null){ _standingsCache.set(key, persisted); return persisted; }
  const data = await afFetch(`/standings?league=${leagueId}&season=${season}`);
  const table = data?.response?.[0]?.league?.standings?.[0] || null;
  _standingsCache.set(key, table);
  // 2026-08-27: `table` is an array — an empty array is still truthy in JS,
  // the same class of bug already found and fixed in buildClubIndex() on
  // 2026-08-25 (an empty-but-truthy result silently locking in as "the real
  // answer"). Require actual rows before persisting, so a transient
  // empty/not-yet-populated standings response can't get cached for up to a
  // year (a completed season) or 24h (current) — only the in-memory value is
  // set either way, so this session still sees it; a future session gets a
  // real retry instead of an empty table baked in.
  if(table && table.length) lsSet(lsKey, table, lsTtlForSeason(season));
  return table;
}

const REF_FACTOR_MIN  = 0.75;
const REF_FACTOR_MAX  = 1.35;
const _refCache = new Map(); // `${ref}_${leagueId}_${season}` → result

// Shared by getRefereeFactor() and getLeagueCardBaseline() — both pull card
// counts for a batch of historical (always-finished) fixtures. Checks/fills
// the same _fixtureDetailCache openMatch() already uses, so a fixture
// sampled by one feature (or previously opened directly by the user) isn't
// re-fetched by the other — real savings once a session's been running a
// while, on top of the rate-limiter fix below which is the main one.
async function getHistoricalCardCount(fx){
  const fid = fx.fixture.id;
  let d = _fixtureDetailCache.get(fid) || lsGet('banits_fx_'+fid);
  if(!d){
    d = await afFetch(`/fixtures?id=${fid}`);
    if(d) cacheFixtureDetail(fid, d); // these are always finished fixtures — persists for future sessions too
  } else if(!_fixtureDetailCache.has(fid)){
    _fixtureDetailCache.set(fid, d); // warm the in-memory cache from the localStorage hit
  }
  const events = d?.response?.[0]?.events || [];
  return events.filter(e=>e.type==='Card').length;
}

async function getRefereeFactor(refereeName, leagueId, season, excludeFixtureId){
  const none = {factor:1, sample:0, avgCards:null, leagueAvgCards:null, refereeName:refereeName||null};
  if(!refereeName || !leagueId || !season) return none;
  const key = `${refereeName}_${leagueId}_${season}`;
  if(_refCache.has(key)) return _refCache.get(key);

  try{
    const data = await afFetch(`/fixtures?league=${leagueId}&season=${season}&status=FT`);
    const all = data?.response || [];
    if(!all.length){ _refCache.set(key, none); return none; }

    // Referee names from the API are inconsistently formatted ("S. Attwell"
    // vs "Stuart Attwell, ENG") — match on the surname token so both forms
    // of the same official still line up.
    const norm = s => (s||'').toLowerCase().replace(/[.,]/g,'').trim();
    const target = norm(refereeName);
    const targetLast = target.split(' ').pop();
    if(!targetLast) return none;

    const refFixtures = all.filter(f=>{
      if(f.fixture.id===excludeFixtureId) return false;
      const r = norm(f.fixture.referee);
      if(!r) return false;
      return r===target || r.split(' ').pop()===targetLast;
    }).slice(0, REF_SAMPLE_CAP);

    if(refFixtures.length < REF_MIN_SAMPLE){
      const result = {...none, sample:refFixtures.length};
      _refCache.set(key, result); return result;
    }

    // Same-size baseline sample from fixtures NOT reffed by this official,
    // so the factor is relative to this league's own card rate rather than
    // an assumed global constant.
    const baselinePool = all
      .filter(f=>!refFixtures.some(rf=>rf.fixture.id===f.fixture.id))
      .slice(0, REF_SAMPLE_CAP);

    const [refCounts, baseCounts] = await Promise.all([
      Promise.all(refFixtures.map(getHistoricalCardCount)),
      Promise.all(baselinePool.map(getHistoricalCardCount)),
    ]);

    const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
    const refAvg = avg(refCounts), baseAvg = avg(baseCounts);

    let result = {...none, sample:refFixtures.length};
    if(refAvg!==null && baseAvg!==null && baseAvg>0){
      const factor = Math.max(REF_FACTOR_MIN, Math.min(REF_FACTOR_MAX, refAvg/baseAvg));
      result = {factor, sample:refFixtures.length, avgCards:refAvg, leagueAvgCards:baseAvg, refereeName};
    }
    _refCache.set(key, result);
    return result;
  }catch(e){
    console.warn('[Banits] referee factor lookup failed (non-fatal, model falls back to 1x):', e.message);
    _refCache.set(key, none);
    return none;
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 4d — RECENT-FORM ADJUSTMENT (/fixtures/players box scores)
// ═══════════════════════════════════════════════════════════════
// A season-long fp90 treats the whole season as one flat rate — a player
// fouling a lot more (or less) than usual over their last few matches reads
// identically to a player on a totally flat trend. This nudges — never
// replaces — the foul-based half of cardProb() toward each player's own
// recent-match rate, exactly the same mechanism as the referee factor
// above (a bounded multiplier on the foul-based term only), with the same
// safeguards: a minimum sample before it's trusted, a clamp so a small
// noisy sample can't swing it wildly, and a factor of 1 (no change) on any
// failure or thin data. See getRecentFormMap()/recentFormFactor().
const RECENT_FORM_MATCHES = 5;    // sample each team's last N finished fixtures
const RECENT_MIN_MINUTES  = 180;  // ~2 full matches — below this, don't trust the recent sample
const RECENT_FACTOR_MIN   = 0.7;
const RECENT_FACTOR_MAX   = 1.5;

// Shared with loadMatchContext()'s form strip — both want "this team's last
// 5 finished fixtures", so one promise-keyed cache means whichever of
// loadSeasonAnalysis()/loadMatchContext() asks first (they run concurrently
// from openMatch()) serves the other's identical in-flight request instead
// of both cold-missing the same URL at once.
const _teamFormCache = new Map(); // teamId → {promise, ts}
const TEAM_FORM_TTL = 180000; // 3 min — matches MATCH_CONTEXT_TTL's window
function getTeamLast5(teamId){
  const cached = _teamFormCache.get(teamId);
  if(cached && (Date.now()-cached.ts) < TEAM_FORM_TTL) return cached.promise;
  const promise = afFetch(`/fixtures?team=${teamId}&last=5&status=FT`);
  _teamFormCache.set(teamId, {promise, ts:Date.now()});
  return promise;
}

// One fixture's full per-player box score (both teams), parsed down to just
// {mins,fouls} per player — that's all the recent-form adjustment needs.
// These are always-finished fixtures (sourced from &status=FT lookups), so
// the result never changes — persisted to localStorage like any other
// finished-fixture data (see cacheFixtureDetail's identical reasoning).
// Promise-cached (not just value-cached) so two teams whose last-5 overlap
// on a shared fixture (they played each other recently) don't both trigger
// a fetch for the same fixture at once.
const _fxPlayersCache = new Map(); // fixtureId → Promise<{[teamId]:{[playerId]:{mins,fouls}}} | null>
function getFixturePlayerBoxes(fid){
  if(_fxPlayersCache.has(fid)) return _fxPlayersCache.get(fid);
  const promise = (async()=>{
    const lsKey = 'banits_fxp_'+fid;
    const persisted = lsGet(lsKey);
    if(persisted) return persisted;
    let byTeam = null;
    try{
      const r = await afFetch(`/fixtures/players?fixture=${fid}`);
      byTeam = {};
      for(const teamBlock of (r?.response||[])){
        const tId = teamBlock?.team?.id;
        if(tId==null) continue;
        const m = {};
        for(const row of (teamBlock.players||[])){
          const pid = row?.player?.id;
          const st = row?.statistics?.[0];
          const mins = st?.games?.minutes||0;
          if(pid==null || !st || mins<=0) continue; // didn't play — no signal either way
          m[pid] = { mins, fouls: st.fouls?.committed||0 };
        }
        byTeam[tId] = m;
      }
    }catch(e){ byTeam = null; } // non-fatal — see section comment
    if(byTeam && Object.keys(byTeam).length) lsSet(lsKey, byTeam, LS_TTL_COMPLETE);
    return byTeam;
  })();
  _fxPlayersCache.set(fid, promise);
  return promise;
}

// Sums one team's players' minutes/fouls across up to RECENT_FORM_MATCHES
// of their own last finished fixtures.
async function aggregateTeamRecentForm(teamId, formData){
  const fids = (formData?.response||[]).slice(-RECENT_FORM_MATCHES).map(f=>f.fixture?.id).filter(Boolean);
  if(!fids.length) return new Map();
  const boxes = await Promise.all(fids.map(getFixturePlayerBoxes));
  const agg = new Map(); // playerId → {mins,fouls}
  for(const byTeam of boxes){
    const teamMap = byTeam?.[teamId];
    if(!teamMap) continue;
    for(const [pidStr, v] of Object.entries(teamMap)){
      const pid = Number(pidStr);
      const cur = agg.get(pid) || {mins:0, fouls:0};
      cur.mins += v.mins; cur.fouls += v.fouls;
      agg.set(pid, cur);
    }
  }
  return agg;
}

// One combined map for both teams in a match — player IDs are globally
// unique, so there's no need to keep the two teams separate at lookup time.
async function getRecentFormMap(hId, aId){
  const [hForm, aForm] = await Promise.all([getTeamLast5(hId), getTeamLast5(aId)]);
  const [hAgg, aAgg] = await Promise.all([
    aggregateTeamRecentForm(hId, hForm),
    aggregateTeamRecentForm(aId, aForm),
  ]);
  return new Map([...hAgg, ...aAgg]);
}

// Bounded multiplier on cardProb()'s foul-based term, same shape as the
// referee factor: ratio of recent fp90 to season fp90, clamped so a thin or
// wild recent sample can't dominate a full season's signal.
function recentFormFactor(recent, seasonFp90){
  if(!recent || recent.mins < RECENT_MIN_MINUTES || !seasonFp90) return 1;
  const recentFp90 = recent.fouls/recent.mins*90;
  const raw = seasonFp90>0 ? recentFp90/seasonFp90 : 1;
  return Math.min(RECENT_FACTOR_MAX, Math.max(RECENT_FACTOR_MIN, raw));
}

// Post-processes an already-resolved player array (season stats already
// fetched/cached with factor 1 baked in — see fetchPlayersThrottled) to
// apply each player's recent-form factor. Returns NEW player objects rather
// than mutating in place, so the shared season-stats cache (reused across
// every other match this player appears in) never carries a match-specific
// adjustment.
function applyRecentForm(players, recentFormMap){
  if(!recentFormMap || !recentFormMap.size) return players;
  return players.map(p=>{
    if(p.prob===null || p.foulsMissing || p.noData) return p;
    const factor = recentFormFactor(recentFormMap.get(p.id), p.fp90);
    if(factor===1) return p;
    return { ...p, prob: cardProb(p.fp90, p.pos, p.yc, p.apps, factor), recentFormFactor: factor };
  });
}

// ═══════════════════════════════════════════════════════════════
// SECTION 4c — MODEL CALIBRATION SELF-CHECK
// ═══════════════════════════════════════════════════════════════
// Honesty note (matters more than the feature): this is NOT a true
// predicted-vs-actual backtest. That would require having logged the
// model's prediction for a player BEFORE each historical match and
// comparing it to what actually happened — this app has no database, so
// no prediction history exists to check against, and recomputing a
// "historical prediction" from each player's CURRENT season stats would
// leak that match's own result into the number used to predict it.
// What this CAN honestly do: compare the model's expected-cards output for
// TODAY's lineups against this league's own real, recent cards-per-match
// rate, as a sanity check that the model's output is in a plausible range
// for this league — not proof of predictive accuracy. Labelled as such in
// the UI. Reuses the same bounded, cached, capped-cost fetch pattern as
// getRefereeFactor().
const CALIB_SAMPLE_CAP = 8;
const _leagueCardCache = new Map(); // `${leagueId}_${season}` → {avgCards, sample} | null

async function getLeagueCardBaseline(leagueId, season){
  if(!leagueId || !season) return null;
  const key = `${leagueId}_${season}`;
  if(_leagueCardCache.has(key)) return _leagueCardCache.get(key);
  try{
    const data = await afFetch(`/fixtures?league=${leagueId}&season=${season}&status=FT`);
    const all = data?.response || [];
    if(!all.length){ _leagueCardCache.set(key,null); return null; }
    const sample = all.slice(0, CALIB_SAMPLE_CAP);
    const counts = await Promise.all(sample.map(getHistoricalCardCount));
    if(!counts.length){ _leagueCardCache.set(key,null); return null; }
    const avgCards = counts.reduce((a,b)=>a+b,0)/counts.length;
    const result = {avgCards, sample:counts.length};
    _leagueCardCache.set(key, result);
    return result;
  }catch(e){
    console.warn('[Banits] league card baseline lookup failed (non-fatal):', e.message);
    _leagueCardCache.set(key, null);
    return null;
  }
}

// Fire-and-forget: patches #calib-check in place once resolved. Safe to
// call from multiple render checkpoints (starters render, bench arrives,
// toggle re-render) — each call just recomputes and overwrites the same
// element; if the element isn't in the DOM (tab rebuilt/closed since), the
// patch is silently skipped rather than throwing.
async function updateCalibrationCheck(fx){
  const el = document.getElementById('calib-check');
  if(!el) return;
  const hExp = calcExpectedCards(_saHomePlayers);
  const aExp = calcExpectedCards(_saAwayPlayers);
  if(hExp===null && aExp===null) return;
  const modelTotal = (hExp||0)+(aExp||0);

  const baseline = await getLeagueCardBaseline(fx.league?.id, fx.league?.season);
  const el2 = document.getElementById('calib-check'); // re-fetch: tab may have re-rendered while awaiting
  if(!el2) return;
  if(!baseline || baseline.sample < 3){
    el2.innerHTML = ''; // not enough league data to say anything useful — stay silent rather than show a hollow box
    return;
  }
  const diffPct = Math.round((modelTotal - baseline.avgCards)/baseline.avgCards*100);
  const withinRange = Math.abs(diffPct) <= 25;
  el2.innerHTML = `<div class="calib-box${withinRange?'':' calib-box-warn'}">
    <div class="calib-hd"><i class="ti ti-chart-dots" style="font-size:10px"></i> Model self-check <span style="color:var(--dim);font-weight:400;text-transform:none;letter-spacing:0">— not a predictive-accuracy backtest, see note</span></div>
    <div class="calib-row">This match's model total (<b>${modelTotal.toFixed(1)}</b>) vs this league's actual average of <b>${baseline.avgCards.toFixed(1)}</b> cards/match (last ${baseline.sample} finished matches) — ${diffPct>=0?'+':''}${diffPct}% ${withinRange?'· within a plausible range':'· notably outside the recent league range, worth a sanity check'}.</div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 5 — FIXTURE LIST
// ═══════════════════════════════════════════════════════════════
async function loadFixtures(){
  const d=selDate();
  document.getElementById('sb-date-lbl').textContent=dayLabel(d);
  const list=document.getElementById('sb-list');
  list.innerHTML='<div class="ld-msg"><div class="spnr"></div>Loading fixtures…</div>';
  _landingErrMsg = null;
  _fixturesFetchDone = false;
  // Paint the "loading" state into the main content area immediately too —
  // previously the main #landing pane stayed completely blank (no spinner,
  // no message) until the fetch resolved, and if it failed there was no
  // error shown there either, just an indefinite blank/"Loading…" area even
  // though the real cause (and, since the retry-button work, a Retry button)
  // was quietly sitting in the sidebar. This is the fix for "dashboard
  // doesn't load and there's no visible error."
  renderLanding();

  // Anything below — network failure, a malformed/unexpected fixture shape
  // from the API, a bug in the render code — used to fail silently: an
  // uncaught exception here left both the sidebar and #landing stuck on
  // "Loading…" forever with nothing in the UI to tell the user why. Wrapping
  // the whole thing means every failure path, known or not, always ends in
  // a visible message + Retry button instead of a silent hang.
  try {
    let {data, error} = await afFetchErr(`/fixtures?date=${isoDate(d)}&timezone=Europe%2FLondon`);
    // Retry once on rate limit (worker caching means second call usually succeeds)
    if(data==='429'||!data){
      await new Promise(r=>setTimeout(r,1500));
      ({data, error} = await afFetchErr(`/fixtures?date=${isoDate(d)}&timezone=Europe%2FLondon`));
    }
    const fixtures=data?.response||[];
    _fixturesFetchDone = true;

    if(!fixtures.length){
      // Distinguish "the call actually failed" from "this day genuinely has no
      // fixtures" — both used to show the same "No fixtures found" text.
      _fixturesCache = [];
      if(data){
        list.innerHTML = '<div class="no-data">No fixtures found for this date.</div>';
      } else {
        // Pass `error` explicitly (from this exact call) rather than letting
        // afFailureMessage fall back to the shared _lastAfError global, which
        // an unrelated concurrent call could have overwritten by now.
        _landingErrMsg = afFailureMessage('Failed to load fixtures', error);
        list.innerHTML = `<div class="no-data">${_landingErrMsg}<br>${retryBtn('Retry', 'loadFixtures()')}</div>`;
      }
      renderLanding();return;
    }

    _fixturesCache = fixtures;
    renderLanding(); // update landing page with fresh data
    renderSidebarList(fixtures);
  } catch(err) {
    console.error('[Banits] loadFixtures failed unexpectedly:', err);
    _fixturesFetchDone = true;
    _fixturesCache = [];
    _landingErrMsg = `Failed to load fixtures — unexpected error (${err.message}). Wait a moment and try again.`;
    list.innerHTML = `<div class="no-data">${_landingErrMsg}<br>${retryBtn('Retry', 'loadFixtures()')}</div>`;
    renderLanding();
  }
}

// Renders the sidebar fixture list + league dropdown from an already-fetched
// fixtures array. Split out of loadFixtures() (2026-08-23) so a pure filter
// change (setLeagueFilter/setSbLeagueFilter) can re-render instantly from
// _fixturesCache instead of re-fetching the network — previously every
// league-dropdown click re-ran the FULL /fixtures?date= fetch (plus, via
// renderLanding()'s call to loadResultsPanel(), a second /fixtures?ids=
// batch call) just to change what's displayed from data already in hand.
function renderSidebarList(fixtures){
  const list=document.getElementById('sb-list');
  if(!list) return;

  // Filter to the tracked leagues only — see TRACKED_LEAGUES
  const euroAll = fixtures.filter(isTrackedLeague);
  // Apply league filter if set
  const visible = _leagueFilter ? euroAll.filter(f=>f.league.id===_leagueFilter) : euroAll;

  // Build league dropdown options (sorted by league rank)
  const lgMap={};
  for(const f of euroAll){
    if(!lgMap[f.league.id])lgMap[f.league.id]={id:f.league.id,name:f.league.name,country:f.league.country,n:0};
    lgMap[f.league.id].n++;
  }
  const lgOpts=Object.values(lgMap)
    .sort((a,b)=>leagueSort(a)-leagueSort(b))
    .map(l=>`<option value="${l.id}"${_leagueFilter===l.id?' selected':''}>${l.country&&l.country!=='World'?l.country+' · ':''} ${l.name} (${l.n})</option>`)
    .join('');
  const filterHtml=`<div class="sb-league-filter">
    <select class="sb-league-sel" onchange="setSbLeagueFilter(this.value?+this.value:null)">
      <option value="">All leagues (${euroAll.length})</option>
      ${lgOpts}
    </select>
  </div>`;

  // Group by league
  const groups={};
  for(const f of visible){
    const key=f.league.id+'_'+f.league.name;
    if(!groups[key])groups[key]={id:f.league.id,name:f.league.name,country:f.league.country,items:[]};
    groups[key].items.push(f);
  }

  // Sort groups by league rank (English first), then fixtures within: live → upcoming → finished
  const sortedGroups=Object.values(groups).sort((a,b)=>leagueSort(a)-leagueSort(b));
  const sortPri=f=>isLive(f.fixture.status.short)?0:isFinal(f.fixture.status.short)?2:1;
  let html=filterHtml;
  for(const g of sortedGroups){
    g.items.sort((a,b)=>(sortPri(a)-sortPri(b))||new Date(a.fixture.date)-new Date(b.fixture.date));
    const comp=g.country&&g.country!=='World'?`${g.country} — ${g.name}`:g.name;
    html+=`<div class="comp-lbl">${comp}</div>`;
    for(const f of g.items){
      const live=isLive(f.fixture.status.short);
      const ht=tinfo(f.teams.home.name);
      const at=tinfo(f.teams.away.name);
      const hasScore=f.goals.home!==null;
      const mid=hasScore?`${f.goals.home}&ndash;${f.goals.away}`:statusDisp(f);
      html+=`<div class="fix-row${f.fixture.id===_activeId?' on':''}" onclick="openMatch(${f.fixture.id})" role="button" tabindex="0" onkeydown="_kbActivate(event)">
        <div class="fix-teams-row">
          ${badge(f.teams.home.logo,'sm',f.teams.home.name)}
          <span class="fx-home" style="color:${ht.c}">${f.teams.home.name}</span>
          <span class="fx-mid${live?' live-c':''}">${mid}</span>
          <span class="fx-away" style="color:${at.c}">${f.teams.away.name}</span>
          ${badge(f.teams.away.logo,'sm',f.teams.away.name)}
        </div>
        <div class="fix-meta-row">
          ${live?'<span class="live-pip">LIVE</span>':'<span></span>'}
          <span>${live?f.fixture.status.elapsed+"'":isFinal(f.fixture.status.short)?'Full time':'Upcoming'}</span>
        </div>
      </div>`;
    }
  }

  list.innerHTML=html;
}

function toggleLeagues(){ /* replaced by league dropdown */ }

function setLeagueFilter(id){
  _leagueFilter = id;
  renderLanding();
  renderSidebarList(_fixturesCache); // local re-render only — no network call
}

function setSbLeagueFilter(id){
  _leagueFilter = id;
  renderSidebarList(_fixturesCache); // local re-render only — no network call
  renderLanding(); // syncs main area
}

// ═══════════════════════════════════════════════════════════════
// SECTION 6 — OPEN MATCH (THE CORE CALL)
// ═══════════════════════════════════════════════════════════════
async function openMatch(fid){
  if(_refreshTmr){clearInterval(_refreshTmr);_refreshTmr=null;}
  // Remember whether this match was opened from a club page (its Recent
  // results/Upcoming fixtures cards reuse openMatch() as-is) so Back
  // returns there instead of always defaulting to the fixtures landing
  // page — every other entry point (landing, sidebar, Leagues mini-table)
  // keeps the existing "Back → Home" behavior unchanged.
  if(_activeClubId){ _matchReturnTo='club'; _matchReturnClubId=_activeClubId; }
  else{ _matchReturnTo='home'; }
  _activeId=fid;
  _leaguesOpen=false;
  _activeClubId=null;
  _clubSearchOpen=false;
  const lgEl=document.getElementById('lg'); if(lgEl)lgEl.style.display='none';
  const clubEl=document.getElementById('club'); if(clubEl)clubEl.style.display='none';
  const csEl=document.getElementById('clubsearch'); if(csEl)csEl.style.display='none';
  syncBottomNav(null); // a match view is a drill-in, not one of the bar's own top-level destinations
  // Reset to neutral immediately so a previous match's referee adjustment
  // (or injury list) can never leak into this one while its own lookup is
  // still in flight.
  _currentRefFactor = 1; _currentRefMeta = null; _currentInjuries = new Map();
  // Keep the URL shareable — replaceState so opening matches doesn't spam
  // browser back/forward history, just reflects "this is what's open now".
  try{ history.replaceState(null, '', matchLinkFor(fid)); }catch(e){}

  // Highlight sidebar row
  document.querySelectorAll('.fix-row').forEach(el=>el.classList.remove('on'));
  document.querySelectorAll('.fix-row').forEach(el=>{
    if(el.getAttribute('onclick')===`openMatch(${fid})`)el.classList.add('on');
  });

  // Switch to match view
  document.getElementById('landing').style.display='none';
  document.getElementById('mv').style.display='flex';
  document.getElementById('mv').style.flexDirection='column';

  // Loading state
  document.getElementById('mv-hdr').innerHTML='<div class="ld-msg"><div class="spnr"></div>Fetching match data…</div>';
  ['ov','lu','ls','sa','mu','tp','od'].forEach(t=>document.getElementById('tab-'+t).innerHTML='<div class="ld-msg"><div class="spnr"></div>Loading…</div>');
  switchTab('ov',document.querySelector('.tab-btn'));
  focusView('mv');

  // ★ THE MAIN CALL — one request returns events + lineups + team stats + player stats
  // Use cache for non-live matches so clicking back+forward is instant —
  // but see fixtureCacheStale() for why "cached" no longer means "cached
  // forever except while live": a pre-kickoff fixture whose lineup hasn't
  // been published yet used to get stuck in cache indefinitely (until the
  // match went live), so reopening it after the real lineup came out kept
  // showing the stale "no lineup yet" state. Finished matches still cache
  // forever (a final result never changes) — and now also survive page
  // reloads/new sessions via localStorage, so revisiting a past result is
  // instant with zero API calls.
  let detail = null;
  let detailErr = null; // captured from this exact call — see _lastAfError note in SECTION 4
  const cached = _fixtureDetailCache.get(fid);
  if(cached && !fixtureCacheStale(cached)){
    detail = cached; // instant — no API call
  } else {
    const persisted = !cached ? lsGet('banits_fx_'+fid) : null; // only worth checking on a cold cache — a stale in-memory entry means we're about to refetch anyway
    const persistedFx = persisted?.response?.[0];
    // 2026-08-27 (follow-up): also re-validate hasUsableLineups() here, not
    // just isFinal() — cacheFixtureDetail() (the write side, below) has
    // refused to persist a final match with broken lineup data ever since
    // that fix shipped, but this READ side previously didn't re-check it, so
    // an entry written to localStorage BEFORE the fix existed (or by KV/edge
    // cache poisoning further upstream) would keep loading "instantly" from
    // disk forever with no way to self-heal — clearing the Worker's KV or
    // even the edge cache does nothing for data already sitting in THIS
    // browser's localStorage. This check is what lets a stale/broken entry
    // fall through to `else` and trigger a real re-fetch instead.
    if(persisted && isFinal(persistedFx?.fixture?.status?.short) && hasUsableLineups(persistedFx)){
      detail = persisted;
      _fixtureDetailCache.set(fid, detail); // warm the in-memory cache too
    } else {
      ({data:detail, error:detailErr} = await afFetchErr(`/fixtures?id=${fid}`));
      if(!detail || detail==='429'){
        // Retry once with backoff
        await new Promise(r=>setTimeout(r,1500));
        ({data:detail, error:detailErr} = await afFetchErr(`/fixtures?id=${fid}`));
      }
      if(detail) cacheFixtureDetail(fid, detail);
    }
  }
  const fx=detail?.response?.[0];
  // The user may have already clicked into a different match while this
  // fetch was in flight (rapid match-switching) — _activeId reflects
  // whatever openMatch() call happened most recently, so if it no longer
  // matches this call's fid, painting now would overwrite that other
  // match's already-rendered view with this stale one. Same guard pattern
  // as loadLeagueStandings() uses for the Leagues tab.
  if(_activeId!==fid)return;
  if(!fx){document.getElementById('mv-hdr').innerHTML=`<div class="ld-msg" style="color:var(--high)">${afFailureMessage('Failed to load fixture', detailErr)}<br>${retryBtn('Retry', `openMatch(${fid})`)}</div>`;return;}

  const ht=tinfo(fx.teams.home.name);
  const at=tinfo(fx.teams.away.name);

  // Render all tabs synchronously from the single response
  _lastFx=fx; _lastHt=ht; _lastAt=at;
  _saHomePlayers=[]; _saAwayPlayers=[]; // reset until season analysis loads
  resetBreaker(); // give each new fixture a clean attempt at player stats
  document.getElementById('mv-hdr').innerHTML=buildHeader(fx,ht,at);
  document.getElementById('tab-ov').innerHTML=buildOverviewTab(fx,ht,at);
  document.getElementById('tab-lu').innerHTML=buildLineupsTab(fx,ht,at);
  document.getElementById('tab-ls').innerHTML=buildLiveStatsTab(fx,ht,at);

  // Season analysis + Odds load in parallel (separate calls)
  loadSeasonAnalysis(fx.teams.home.id,fx.teams.away.id,fx,ht,at);
  loadOddsTab(fid,fx,ht,at);
  // Form strips + standings (non-blocking, fills placeholders in header/overview)
  loadMatchContext(fx,ht,at);

  // Auto-refresh every 30s for live matches; for an upcoming match whose
  // lineup isn't out yet, poll more gently (90s) just to catch the lineup
  // announcement automatically — see pollForLineup().
  const hasLineupsNow = (fx.lineups||[]).length>=2;
  if(isLive(fx.fixture.status.short)){
    _refreshTmr=setInterval(()=>refreshLive(fid),30000);
  } else if(!isFinal(fx.fixture.status.short) && !hasLineupsNow){
    _refreshTmr=setInterval(()=>pollForLineup(fid),90000);
  }
}

// TTL for a cached fixture whose lineup hasn't been published yet — short,
// so reopening the match view picks up a newly-announced lineup within a
// couple of minutes instead of showing the stale pre-lineup state for the
// rest of the session. Once the lineup IS out (but kickoff hasn't happened),
// a longer TTL is enough — late lineup changes are rare and not urgent to
// catch instantly. A live match always bypasses this (handled separately,
// same as before); a finished match is never stale (handled in
// fixtureCacheStale()).
const FX_TTL_NO_LINEUP   = 90000;   // 90s
const FX_TTL_LINEUP_SET  = 300000;  // 5 min

// 2026-08-27: a final match's lineups can come back with a real startXI
// list but no per-player grid/formation data — a genuine, observed
// API-Football data-quality gap (not every competition/round gets that
// layer populated in time), rather than a client bug. When it happens,
// gridXY() has nothing to place players with, so every player collapses
// onto the same pitch coordinate and the formation badge shows "?". A
// final match with this problem would otherwise get treated as "safe to
// cache forever" purely because its RESULT is final — locking the broken
// layout into localStorage permanently. This only returns false for the
// genuinely-broken case (lineups reported but incomplete for a team) —
// a final match that never gets lineup data published at all (lineups.length
// < 2) is a normal, legitimate state and is NOT treated as broken here.
function hasUsableLineups(fx){
  const lineups = fx?.lineups || [];
  if(lineups.length < 2) return true;
  return lineups.every(l => l?.formation && Array.isArray(l?.startXI) && l.startXI.length > 0);
}
function fixtureCacheStale(cached){
  const f = cached?.response?.[0];
  if(!f) return true;
  const status = f.fixture?.status?.short;
  if(isLive(status)) return true;   // always refetch live matches
  if(isFinal(status)) return !hasUsableLineups(f); // final result never changes — but keep retrying if the lineup data came back broken
  const hasLineups = (f.lineups||[]).length>=2;
  const ttl = hasLineups ? FX_TTL_LINEUP_SET : FX_TTL_NO_LINEUP;
  return (Date.now() - (cached._cachedAt||0)) >= ttl;
}
function cacheFixtureDetail(fid, detail){
  detail._cachedAt = Date.now();
  _fixtureDetailCache.set(fid, detail);
  // A finished match's result/lineups/events never change again — worth
  // persisting across reloads/sessions so reopening a past match is free.
  // See LS_TTL_COMPLETE/isSeasonComplete in the persistent-cache helpers.
  // Skip persisting to localStorage (but still keep the in-memory copy —
  // it's still the best data available this session) when the lineup data
  // came back broken — see hasUsableLineups() — so a future session gets a
  // fresh shot at a complete lineup instead of a broken one locked in.
  const status = detail?.response?.[0]?.fixture?.status?.short;
  if(isFinal(status) && hasUsableLineups(detail?.response?.[0])) lsSet('banits_fx_'+fid, detail, LS_TTL_COMPLETE);
}

// Shared by the live-match ticker and the pre-kickoff lineup-watch ticker:
// always bypasses the fixture-detail cache (the whole point of a background
// poll is to see something new), re-renders the views that can change from
// this call (header/overview/lineups/live-stats), and returns the fresh
// fixture object so each ticker can decide whether to keep polling.
async function refreshMatchView(fid){
  const detail=await afFetch(`/fixtures?id=${fid}`);
  const fx=detail?.response?.[0];
  if(!fx) return null;
  cacheFixtureDetail(fid, detail); // cache the fresh data regardless of what's on screen — it's still useful later
  // Belt-and-suspenders: never paint over a match that's no longer active.
  // Callers also re-check fid===_activeId around their own follow-up logic
  // (interval bookkeeping), but guarding the DOM write here too means any
  // future caller of refreshMatchView() gets this safety for free.
  if(fid!==_activeId) return fx;
  const ht=tinfo(fx.teams.home.name);
  const at=tinfo(fx.teams.away.name);
  _lastFx=fx; _lastHt=ht; _lastAt=at;
  document.getElementById('mv-hdr').innerHTML=buildHeader(fx,ht,at);
  document.getElementById('tab-ov').innerHTML=buildOverviewTab(fx,ht,at);
  document.getElementById('tab-lu').innerHTML=buildLineupsTab(fx,ht,at);
  document.getElementById('tab-ls').innerHTML=buildLiveStatsTab(fx,ht,at);
  return fx;
}

async function refreshLive(fid){
  // A stale invocation (this match is no longer the active one) must never
  // touch _refreshTmr — openMatch() already cleared/reassigned that shared
  // slot the moment the active match changed, so by now it may belong to a
  // DIFFERENT match's own ticker. Just no-op instead of clearInterval'ing
  // whatever's currently in there.
  if(fid!==_activeId)return;
  const fx = await refreshMatchView(fid);
  if(!fx) return;
  // Re-check after the await: the user may have switched to a different
  // match while this fetch was in flight. _refreshTmr is a single shared
  // timer slot — if we're stale, it may already belong to a NEW ticker for
  // whatever match is active now, so touching it here (loadFixtures() is
  // harmless, but clearInterval/reassignment below is not) would silently
  // kill that match's legitimate live/lineup-watch ticker.
  if(fid!==_activeId)return;
  loadFixtures(); // refresh sidebar scores
  if(!isLive(fx.fixture.status.short)){clearInterval(_refreshTmr);_refreshTmr=null;}
}

// Gentle background poll for a match that hasn't kicked off and has no
// confirmed lineup yet — the moment the lineup appears, re-run season
// analysis (so starters/bench swap in from whatever placeholder view was
// showing) and hand off to the normal live ticker if the match has also
// since kicked off. No manual reload needed to catch a lineup announcement.
async function pollForLineup(fid){
  // See refreshLive()'s identical guard — a stale invocation must not touch
  // the shared _refreshTmr slot, which may already belong to a different
  // match's ticker by the time this fires.
  if(fid!==_activeId)return;
  const fx = await refreshMatchView(fid);
  if(!fx) return;
  // Same re-check as refreshLive() — see comment there. Without this, a
  // lineup-watch poll for a match the user has since navigated away from
  // could clear or overwrite the new match's own ticker via the shared
  // _refreshTmr slot, or fire loadSeasonAnalysis()/a new setInterval for a
  // fixture that isn't even open anymore.
  if(fid!==_activeId)return;
  const hasLineups = (fx.lineups||[]).length>=2;
  const live = isLive(fx.fixture.status.short);
  const final = isFinal(fx.fixture.status.short);
  if(hasLineups || live || final){
    clearInterval(_refreshTmr); _refreshTmr=null;
    if(hasLineups) loadSeasonAnalysis(fx.teams.home.id,fx.teams.away.id,fx,_lastHt,_lastAt);
    if(live) _refreshTmr=setInterval(()=>refreshLive(fid),30000);
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 7b — MATCH CONTEXT (form strips + standings)
// Loads in background after the match view renders
// ═══════════════════════════════════════════════════════════════
// Cache of a match's form/standings/h2h context, keyed by fixture id. Bouncing
// between a few matches in the same session previously re-fetched all three
// every single time, even seconds after the last visit — this data doesn't
// change meaningfully within a few minutes, so a short TTL cache makes
// re-opening a recently-viewed match feel instant instead of re-running the
// whole paced fetch queue again.
const _matchContextCache = new Map(); // fixture id → {hForm,aForm,standingsTable,h2hData,ts}
const MATCH_CONTEXT_TTL = 180000; // 3 minutes

async function loadMatchContext(fx,ht,at){
  const hId=fx.teams.home.id, aId=fx.teams.away.id;
  const lgId=fx.league?.id, lgSeason=fx.league?.season;
  const isIntl=INTL_LEAGUES.has(lgId);
  const fid=fx.fixture?.id;

  // Load form + standings + H2H in parallel
  // NOTE (2026-08-23 fix): head-to-head history lives at a DIFFERENT
  // endpoint — /fixtures/headtohead — not /fixtures with an h2h param.
  // /fixtures doesn't accept h2h at all, so this call has been failing on
  // every single match view with a genuine upstream error ("The h2h field do
  // not exist") — the h2h panel has silently never had data. Unrelated to
  // rate limiting; just a wrong endpoint.
  let hForm,aForm,standingsTable,h2hData;
  const cached = fid && _matchContextCache.get(fid);
  if(cached && (Date.now()-cached.ts) < MATCH_CONTEXT_TTL){
    ({hForm,aForm,standingsTable,h2hData}=cached);
  } else {
    [hForm,aForm,standingsTable,h2hData]=await Promise.all([
      getTeamLast5(hId),
      getTeamLast5(aId),
      isIntl?null:getStandingsTable(lgId, lgSeason),
      afFetch(`/fixtures/headtohead?h2h=${hId}-${aId}&last=5&status=FT`),
    ]);
    if(fid) _matchContextCache.set(fid, {hForm,aForm,standingsTable,h2hData,ts:Date.now()});
  }

  // ── Form strips ──────────────────────────────────────────────
  function processForm(data,teamId){
    const rows=data?.response||[];
    return rows.slice(-5).map(f=>{
      const isH=f.teams.home.id===teamId;
      const scored=isH?f.goals.home:f.goals.away;
      const conceded=isH?f.goals.away:f.goals.home;
      const opp=isH?f.teams.away.name:f.teams.home.name;
      const r=scored>conceded?'W':scored<conceded?'L':'D';
      return{r,scored,conceded,opp};
    });
  }
  function renderForm(form){
    if(!form.length)return`<span style="color:var(--dim);font-size:9px">No data</span>`;
    return form.map(m=>`<span class="form-b form-${m.r.toLowerCase()}" title="${m.r} vs ${m.opp} (${m.scored}-${m.conceded})">${m.r}</span>`).join('');
  }
  const hFd=processForm(hForm,hId), aFd=processForm(aForm,aId);
  const hEl=document.getElementById('ctx-form-h');
  const aEl=document.getElementById('ctx-form-a');
  if(hEl) hEl.innerHTML=renderForm(hFd);
  if(aEl) aEl.innerHTML=renderForm(aFd);

  // ── League standings ─────────────────────────────────────────
  if(!isIntl && standingsTable){
    const table=standingsTable;
    const hIdx=table.findIndex(t=>t.team.id===hId);
    const aIdx=table.findIndex(t=>t.team.id===aId);

    // Build set of row indices to show: top 3 + 1 around each team
    const show=new Set([0,1,2]);
    [hIdx,aIdx].forEach(idx=>{
      if(idx>=0)[idx-1,idx,idx+1].forEach(i=>{if(i>=0&&i<table.length)show.add(i);});
    });
    const sorted=[...show].sort((a,b)=>a-b);

    let tbl='<div class="mini-table">';
    let prev=-1;
    for(const idx of sorted){
      if(prev>=0&&idx>prev+1)tbl+=`<div class="mini-table-gap">⋯</div>`;
      const t=table[idx];
      const isH=t.team.id===hId, isA=t.team.id===aId;
      const col=isH?ht.c:isA?at.c:'';
      const recentForm=(t.form||'').slice(-5).split('');
      const formDots=recentForm.map(r=>`<div class="mt-fb" style="background:${r==='W'?'#16a34a':r==='L'?'#dc2626':'#ca8a04'}"></div>`).join('');
      tbl+=`<div class="mini-table-row${isH||isA?' hl':''}" style="${col?'border-left:3px solid '+col+';':''}" title="${t.team.name} — ${t.points}pts, GD ${t.goalsDiff>=0?'+':''}${t.goalsDiff}">
        <span class="mt-pos">${t.rank}</span>
        <span class="mt-team" style="${col?'color:'+col:''}font-weight:${isH||isA?800:400}">${t.team.name}</span>
        <span class="mt-pts">${t.points}</span>
        <span class="mt-gd">${t.goalsDiff>=0?'+':''}${t.goalsDiff}</span>
        <div class="mt-form">${formDots}</div>
      </div>`;
      prev=idx;
    }
    tbl+='</div>';

    const stEl=document.getElementById('ctx-standings');
    if(stEl) stEl.innerHTML=tbl;
  } else if(!isIntl){
    const stEl=document.getElementById('ctx-standings');
    if(stEl) stEl.innerHTML=`<div style="color:var(--dim);font-size:11px;padding:4px 0">Standings available after season start</div>`;
  }

  // ── Head-to-head history ──────────────────────────────────────
  const h2hEl=document.getElementById('ctx-h2h');
  if(h2hEl && h2hData?.response?.length){
    const matches=h2hData.response.slice(-5).reverse();
    const hWins=matches.filter(m=>{
      const isH=m.teams.home.id===hId;
      return isH?m.goals.home>m.goals.away:m.goals.away>m.goals.home;
    }).length;
    const aWins=matches.filter(m=>{
      const isA=m.teams.away.id===aId||m.teams.home.id===aId;
      const aScored=m.teams.home.id===aId?m.goals.home:m.goals.away;
      const hScored=m.teams.home.id===aId?m.goals.away:m.goals.home;
      return aScored>hScored;
    }).length;
    const draws=matches.length-hWins-aWins;

    const rows=matches.map(m=>{
      const mH=m.teams.home.id===hId;
      const hG=mH?m.goals.home:m.goals.away;
      const aG=mH?m.goals.away:m.goals.home;
      const result=hG>aG?'H':aG>hG?'A':'D';
      const hn=m.teams.home.name.split(' ').slice(-1)[0];
      const an=m.teams.away.name.split(' ').slice(-1)[0];
      const date=new Date(m.fixture.date);
      const mo=date.toLocaleString('default',{month:'short',year:'2-digit'});
      const hCol=m.teams.home.id===hId?ht.c:at.c;
      const aCol=m.teams.away.id===aId?at.c:ht.c;
      const badgeCls=result==='H'?'h2h-h':result==='A'?'h2h-a':'h2h-d';
      return`<div class="h2h-row">
        <span class="h2h-date">${mo}</span>
        <span style="flex:1;font-size:10px;font-weight:600;color:${hCol};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${hn}</span>
        <span class="h2h-score">${hG}–${aG}</span>
        <span style="flex:1;font-size:10px;font-weight:600;color:${aCol};text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${an}</span>
        <span class="h2h-badge ${badgeCls}">${result}</span>
      </div>`;
    }).join('');

    h2hEl.innerHTML=`<div class="h2h-panel">
      <div class="ctx-sec-hd"><i class="ti ti-arrows-exchange" style="font-size:11px"></i>Head to head (last ${matches.length})</div>
      ${rows}
      <div class="h2h-summary">
        <div class="h2h-sum-col">
          <span class="h2h-sum-num" style="color:${ht.c}">${hWins}W</span>
          <span class="h2h-sum-lbl">${fx.teams.home.name.split(' ')[0]}</span>
        </div>
        <div class="h2h-sum-col">
          <span class="h2h-sum-num" style="color:var(--dim)">${draws}D</span>
          <span class="h2h-sum-lbl">Drawn</span>
        </div>
        <div class="h2h-sum-col">
          <span class="h2h-sum-num" style="color:${at.c}">${aWins}W</span>
          <span class="h2h-sum-lbl">${fx.teams.away.name.split(' ')[0]}</span>
        </div>
      </div>
    </div>`;
  } else if(h2hEl){
    h2hEl.innerHTML='';
  }
}
// (per-minute) or daily quota. Retrying immediately won't help for a daily
// quota, so this gives the user a clear explanation and a manual retry button
// rather than the UI silently grinding for minutes.
function buildRateLimitMessage(){
  return`<div class="no-data" style="padding:40px 20px">
    <i class="ti ti-alert-triangle" style="color:var(--med)"></i>
    <strong style="color:var(--med)">Player stats could not be loaded</strong><br>
    ${_callCount} API calls made this session. The player stats endpoint
    (<code>/players?id=X</code>) either exceeded the rate limit for your plan,
    or is not accessible from this browser context.<br><br>
    <strong>Season queried: 2025/26</strong> — only the current season is attempted.<br><br>
    ${retryBtn('Retry analysis', `resetBreaker();loadSeasonAnalysis(${_lastFx?.teams?.home?.id},${_lastFx?.teams?.away?.id},_lastFx,_lastHt,_lastAt)`)}
  </div>`;
}

// Club-page equivalent of buildRateLimitMessage() — same breaker-tripped
// story, but retries this club's squad load instead of a match's season
// analysis. Previously the club page never checked the breaker at all, so
// tripping it here just rendered every squad player as generic "no data"
// with no explanation and no way to retry.
function buildClubRateLimitMessage(teamId){
  return`<div class="no-data" style="padding:40px 20px">
    <i class="ti ti-alert-triangle" style="color:var(--med)"></i>
    <strong style="color:var(--med)">Player stats could not be loaded</strong><br>
    ${_callCount} API calls made this session. The player stats endpoint
    (<code>/players?id=X</code>) either exceeded the rate limit for your plan,
    or is not accessible from this browser context.<br><br>
    ${retryBtn('Retry squad stats', `resetBreaker();loadClubPage(${teamId})`)}
  </div>`;
}

async function loadSeasonAnalysis(hId,aId,fx,ht,at){
  const isIntl = INTL_LEAGUES.has(fx.league?.id);
  const lineups = fx.lineups||[];
  const hasLineups = lineups.length >= 2;

  // Referee tendency — resolved once, up front, so every cardProb() call
  // made anywhere below (for any player, in any branch) already reflects
  // it. See getRefereeFactor() for methodology and safeguards; on any
  // failure or insufficient data this safely resolves to factor:1, i.e.
  // identical behaviour to before this feature existed.
  // Injuries fetched alongside referee tendency — independent lookups, no
  // reason to serialize them. Whichever finishes last, both are resolved
  // before any player card below is built, exactly like the referee factor.
  const [refInfo, injuredMap] = await Promise.all([
    getRefereeFactor(fx.fixture?.referee, fx.league?.id, fx.league?.season, fx.fixture?.id),
    getInjuries(fx.fixture?.id),
  ]);
  _currentRefFactor = refInfo.factor;
  _currentRefMeta = refInfo;
  _currentInjuries = injuredMap;

  if(isIntl && hasLineups){
    // ── NATIONAL TEAM MATCH with confirmed lineup ───────────────
    // PHASE 1: Fetch starters in parallel (22 calls), render immediately.
    // PHASE 2: Fetch bench in background, update tab without user waiting.
    const hStarters = lineups[0]?.startXI?.map(p=>p.player).filter(p=>p?.id)||[];
    const hBench    = lineups[0]?.substitutes?.map(p=>p.player).filter(p=>p?.id)||[];
    const aStarters = lineups[1]?.startXI?.map(p=>p.player).filter(p=>p?.id)||[];
    const aBench    = lineups[1]?.substitutes?.map(p=>p.player).filter(p=>p?.id)||[];
    const seasonChain = seasonChainFromMode();
    const cSeason = seasonChain[0];
    const totalStarters = hStarters.length + aStarters.length;

    function showProgress(done, total, phase){
      document.getElementById('tab-sa').innerHTML=
        `<div class="ld-msg">
          <div class="spnr"></div>
          <span>${phase} — ${done}/${total} players loaded</span>
          <div class="ld-progress"><div class="ld-progress-fill" style="width:${Math.round(done/total*100)}%"></div></div>
        </div>`;
    }
    showProgress(0, totalStarters, 'Fetching starters');

    // Phase 1 — starters
    const starterResults = await fetchPlayersThrottled(
      [...hStarters,...aStarters], seasonChain,
      (done,total)=>showProgress(done,total,'Fetching starters')
    );
    if(_breakerTripped){document.getElementById('tab-sa').innerHTML=buildRateLimitMessage();return;}

    let i=0;
    const hStartP = starterResults.slice(i,i+=hStarters.length).map(p=>({...p,xistatus:'starter'})).sort((a,b)=>(b.prob??-1)-(a.prob??-1));
    const aStartP = starterResults.slice(i,i+=aStarters.length).map(p=>({...p,xistatus:'starter'})).sort((a,b)=>(b.prob??-1)-(a.prob??-1));

    // Render starters immediately so users have data to read
    const hP = [...hStartP], aP = [...aStartP];
    _saHomePlayers=hP; _saAwayPlayers=aP;
    document.getElementById('tab-sa').innerHTML = buildSeasonTab(hP,aP,fx,ht,at,{isIntl,cSeason,src:'club',hasLineups:true,hStarters:hStartP.length,aStarters:aStartP.length});
    refreshPitchOverlay(); renderMatchupsTab(fx,ht,at); renderTopPicksTab(fx,ht,at); updateCalibrationCheck(fx);

    // Phase 2 — bench (background, non-blocking)
    if(hBench.length||aBench.length){
      const totalBench = hBench.length + aBench.length;
      const benchResults = await fetchPlayersThrottled(
        [...hBench,...aBench], seasonChain, null // no progress bar for background load
      );
      if(!_breakerTripped){
        let j=0;
        const hBenchP = benchResults.slice(j,j+=hBench.length).map(p=>({...p,xistatus:'bench'})).sort((a,b)=>(b.prob??-1)-(a.prob??-1));
        const aBenchP = benchResults.slice(j,j+=aBench.length).map(p=>({...p,xistatus:'bench'})).sort((a,b)=>(b.prob??-1)-(a.prob??-1));
        hP.push(...hBenchP); aP.push(...aBenchP);
        _saHomePlayers=hP; _saAwayPlayers=aP;
        // Only update the analysis tab if it's currently visible
        document.getElementById('tab-sa').innerHTML = buildSeasonTab(hP,aP,fx,ht,at,{isIntl,cSeason,src:'club',hasLineups:true,hStarters:hStartP.length,aStarters:aStartP.length});
        renderTopPicksTab(fx,ht,at); updateCalibrationCheck(fx);
      }
    }

  } else if(isIntl && !hasLineups){
    // ── NATIONAL TEAM MATCH, no lineup confirmed yet ────────────
    // /players/squads returns the full confirmed squad (23-26 players) the moment
    // a federation submits it — independent of any specific match's lineup.
    // This lets us show club-stat card probabilities for the whole squad pre-kickoff.
    document.getElementById('tab-sa').innerHTML=
      `<div class="ld-msg"><div class="spnr"></div>Fetching confirmed squad lists…</div>`;

    const [hSquad, aSquad] = await Promise.all([
      afFetch(`/players/squads?team=${hId}`),
      afFetch(`/players/squads?team=${aId}`),
    ]);
    const hSquadPlayers = hSquad?.response?.[0]?.players||[];
    const aSquadPlayers = aSquad?.response?.[0]?.players||[];

    if(hSquadPlayers.length && aSquadPlayers.length){
      document.getElementById('tab-sa').innerHTML=
        `<div class="ld-msg"><div class="spnr"></div>Fetching club stats for ${hSquadPlayers.length+aSquadPlayers.length} squad players — requests are rate-limited to ~1/sec, so this can take ${Math.ceil((hSquadPlayers.length+aSquadPlayers.length)*1.1/10)*10}–${Math.ceil((hSquadPlayers.length+aSquadPlayers.length)*1.4/10)*10}s for full squads…</div>`;

      const seasonChain = seasonChainFromMode();
      const cSeason = seasonChain[0];
      const allPlayers = [...hSquadPlayers, ...aSquadPlayers];
      const results = await fetchPlayersThrottled(allPlayers, seasonChain);

      const hP = results.slice(0, hSquadPlayers.length).sort((a,b)=>(b.prob??-1)-(a.prob??-1));
      const aP = results.slice(hSquadPlayers.length).sort((a,b)=>(b.prob??-1)-(a.prob??-1));

      if(_breakerTripped){
        document.getElementById('tab-sa').innerHTML = buildRateLimitMessage();
        return;
      }
      document.getElementById('tab-sa').innerHTML = buildSeasonTab(hP,aP,fx,ht,at,{isIntl,cSeason,src:'squad'});
      _saHomePlayers=hP; _saAwayPlayers=aP;
      refreshPitchOverlay();
      renderMatchupsTab(fx,ht,at);
    renderTopPicksTab(fx,ht,at); updateCalibrationCheck(fx);
    } else {
      // Squads not submitted yet OR CORS blocked /players/squads — try national competition stats
      const seasons = seasonChainFromMode();

      async function fetchTeamIntl(id, name){
        for(const s of seasons){
              const r=await afFetch(`/players?team=${id}&season=${s}`);
          const n=r?.response?.length||0;
              if(n) return r;
        }
          return null;
      }

      const [hR,aR] = await Promise.all([
        fetchTeamIntl(hId, fx.teams.home.name),
        fetchTeamIntl(aId, fx.teams.away.name),
      ]);
      const hP = processPlayers(hR?.response||[]);
      const aP = processPlayers(aR?.response||[]);

      // If both come back empty, the request was blocked — show a clear diagnostic
      if(!hP.length && !aP.length){
        document.getElementById('tab-sa').innerHTML=`
          <div class="tip-box" style="margin-bottom:12px;border-color:rgba(212,21,21,.35);background:rgba(212,21,21,.06)">
            <strong style="color:var(--high)">⚠ No player stats available</strong><br><br>
            Squad data is not yet available for this fixture.
            Check back closer to kickoff — once the lineup is confirmed, the Analysis tab will
            automatically show full club-season stats for each starter.
            <br><br>
            <b>Seasons attempted:</b> <code style="color:var(--gold)">${seasons.join(', ')}</code>
            <br>${retryBtn('Retry', `loadSeasonAnalysis(${hId},${aId},_lastFx,_lastHt,_lastAt)`)}
          </div>`;
        return;
      }

      document.getElementById('tab-sa').innerHTML = buildSeasonTab(hP,aP,fx,ht,at,{isIntl,src:'intl'});
      _saHomePlayers=hP; _saAwayPlayers=aP;
      renderMatchupsTab(fx,ht,at);
    renderTopPicksTab(fx,ht,at); updateCalibrationCheck(fx);
    }

  } else {
    // ── CLUB MATCH ──────────────────────────────────────────────
    // Season handling (2026-08-25 rework): '2025'/'2026' are now STRICT —
    // they show exactly that season's data, with an honest "no data this
    // season" rather than a silent, unlabeled swap to the other season (the
    // old behavior always tried a 2nd season behind the scenes regardless of
    // what the picker said, which is exactly why the toggle could look like
    // it "wasn't doing anything" — most 26/27 numbers were quietly actually
    // 25/26). 'both' is the explicit, clearly-labeled way to combine seasons
    // — see blendPlayerStats().
    const blend = _seasonMode==='both';
    const selSeason = numericSeason(), cSeason = selSeason;

    if(hasLineups){
      // Pure player-ID queries through the Cloudflare Worker.
      // Every lineup player gets /players?id=X&season=Y — no name matching,
      // no team queries, no gap detection. Clean and reliable.
      const seasonChain = blend ? [lastClubSeason()-1, lastClubSeason()] : [selSeason];
      const hStarters=lineups[0]?.startXI?.map(p=>p.player).filter(p=>p?.id)||[];
      const hBench   =lineups[0]?.substitutes?.map(p=>p.player).filter(p=>p?.id)||[];
      const aStarters=lineups[1]?.startXI?.map(p=>p.player).filter(p=>p?.id)||[];
      const aBench   =lineups[1]?.substitutes?.map(p=>p.player).filter(p=>p?.id)||[];
      const totalS   =hStarters.length+aStarters.length;

      function showProg(done,total,phase){
        document.getElementById('tab-sa').innerHTML=`<div class="ld-msg">
          <div class="spnr"></div>
          <span>${phase} — ${done}/${total} players</span>
          <div class="ld-progress"><div class="ld-progress-fill" style="width:${Math.round(done/total*100)}%"></div></div>
        </div>`;
      }
      showProg(0,totalS,'Fetching starters');

      // Phase 1 — starters (render immediately so user sees data fast).
      // recentFormMap fetched alongside — see SECTION 4d — so the first
      // render already reflects each starter's last-5-match trend, not
      // just their season average. Its own internal calls (team form +
      // per-fixture box scores) are independently rate-limited/cached, so
      // running it in parallel here costs no extra wall-clock time.
      resetBreaker();
      const [sRes, recentFormMap] = await Promise.all([
        fetchPlayersThrottled(
          [...hStarters,...aStarters], seasonChain,
          (done,total)=>showProg(done,total,'Fetching starters'), {blend}
        ),
        getRecentFormMap(hId, aId),
      ]);
      if(_breakerTripped){document.getElementById('tab-sa').innerHTML=buildRateLimitMessage();return;}

      let i=0;
      const hStartP=applyRecentForm(sRes.slice(i,i+=hStarters.length),recentFormMap).map(p=>({...p,xistatus:'starter'})).sort((a,b)=>(b.prob??-1)-(a.prob??-1));
      const aStartP=applyRecentForm(sRes.slice(i,i+=aStarters.length),recentFormMap).map(p=>({...p,xistatus:'starter'})).sort((a,b)=>(b.prob??-1)-(a.prob??-1));

      const hP=[...hStartP], aP=[...aStartP];
      _saHomePlayers=hP; _saAwayPlayers=aP;
      document.getElementById('tab-sa').innerHTML=buildSeasonTab(hP,aP,fx,ht,at,{isIntl:false,cSeason,src:'club',hasLineups:true,hStarters:hStartP.length,aStarters:aStartP.length,blend,seasonChain});
      refreshPitchOverlay(); renderMatchupsTab(fx,ht,at); renderTopPicksTab(fx,ht,at); updateCalibrationCheck(fx);

      // Phase 2 — bench loads in background
      if(hBench.length||aBench.length){
        const bRes=await fetchPlayersThrottled([...hBench,...aBench],seasonChain,null,{blend});
        if(!_breakerTripped){
          let j=0;
          const hBenchP=applyRecentForm(bRes.slice(j,j+=hBench.length),recentFormMap).map(p=>({...p,xistatus:'bench'})).sort((a,b)=>(b.prob??-1)-(a.prob??-1));
          const aBenchP=applyRecentForm(bRes.slice(j,j+=aBench.length),recentFormMap).map(p=>({...p,xistatus:'bench'})).sort((a,b)=>(b.prob??-1)-(a.prob??-1));
          hP.push(...hBenchP); aP.push(...aBenchP);
          _saHomePlayers=hP; _saAwayPlayers=aP;
          document.getElementById('tab-sa').innerHTML=buildSeasonTab(hP,aP,fx,ht,at,{isIntl:false,cSeason,src:'club',hasLineups:true,hStarters:hStartP.length,aStarters:aStartP.length,blend,seasonChain});
          renderTopPicksTab(fx,ht,at); updateCalibrationCheck(fx);
        }
      }
    } else {
      // No lineup: team roster queries (shows full squad for pre-match analysis)
      const altSeason=selSeason===lastClubSeason()?lastClubSeason()-1:lastClubSeason();
      document.getElementById('tab-sa').innerHTML=
        `<div class="ld-msg"><div class="spnr"></div>Loading ${blend?`combined ${[altSeason,selSeason].sort((a,b)=>a-b).map(s=>s+'/'+String(s+1).slice(2)).join('+')}`:`${cSeason}/${String(cSeason+1).slice(2)}`} squad…</div>`;

      async function fetchTeamAllPages(teamId,season){
        const first=await afFetch(`/players?team=${teamId}&season=${season}`);
        if(!first?.response?.length) return [];
        const all=[...first.response];
        const total=first.paging?.total||1;
        if(total>1){
          const extras=await Promise.all(
            Array.from({length:total-1},(_,k)=>afFetch(`/players?team=${teamId}&season=${season}&page=${k+2}`))
          );
          for(const r of extras) if(r?.response) all.push(...r.response);
        }
        return all;
      }

      // Strict modes ('2025'/'2026') deliberately skip the alt-season roster
      // fetch entirely — 2 fewer API calls, and it's what makes "26/27
      // strict" actually strict instead of quietly filling gaps from 25/26.
      // 'both' fetches and merges both, preferring whichever season has the
      // player (existing merge-by-preference below), same as before this
      // rework for this particular (pre-lineup) view.
      const [hPl,aPl,hAl,aAl]=await Promise.all([
        fetchTeamAllPages(hId,selSeason),fetchTeamAllPages(aId,selSeason),
        blend?fetchTeamAllPages(hId,altSeason):Promise.resolve([]),
        blend?fetchTeamAllPages(aId,altSeason):Promise.resolve([]),
      ]);

      function nn2(n){return(n||'').toLowerCase().replace(/ß/g,'ss').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,' ').replace(/ +/g,' ').trim();}

      function buildSqLookup(players){
        const bN=new Map(),bS=new Map();
        for(const r of players){
          const p=r.player,all=r.statistics||[];
          const dom=all.filter(s=>!INTL_LEAGUES.has(s.league?.id)&&(s.games?.appearences||0)>0);
          if(!dom.length) continue;
          let tA=0,tM=0,tFC=0,tFD=0,tTK=0,tYC=0,tD=0,tDW=0,tDT=0;
          for(const s of dom){tA+=s.games?.appearences||0;tM+=s.games?.minutes||0;tFC+=s.fouls?.committed||0;tFD+=s.fouls?.drawn||0;tTK+=s.tackles?.total||0;tYC+=s.cards?.yellow||0;tD+=s.dribbles?.attempts||0;tDW+=s.duels?.won||0;tDT+=s.duels?.total||0;}
          if(!tA) continue;
          const mins=Math.max(tM||tA*70,1);
          const pr=dom.slice().sort((a,b)=>(b.games?.appearences||0)-(a.games?.appearences||0))[0];
          const pos=normalizePos(pr.games?.position),fp90=tFC/mins*90;
          const fM=(pos!=='G')&&tA>=4&&tFC===0&&tTK===0;
          const ex=dom.length>1?` +${dom.length-1} cup${dom.length>2?'s':''}`:'' ;
          const e={id:p.id,name:p.name,pos,posL:posLabel(pos),photo:p.photo||null,fp90,tp90:tTK/mins*90,yc:tYC,apps:tA,mins,totalFouls:tFC,totalTackles:tTK,fd90:tFD/mins*90,drb90:tD/mins*90,duelsW90:tDW/mins*90,duelsT90:tDT/mins*90,prob:fM?null:cardProb(fp90,pos,tYC,tA),srcLeague:(pr.league?.name||'')+ex,srcTeam:pr.team?.name,srcSeason:pr.league?.season,lowConf:tA<8,foulsMissing:fM,isClub:true,noData:false};
          const n=nn2(p.name);bN.set(n,e);const s=n.split(' ').pop();if(!bS.has(s))bS.set(s,e);
        }
        return{byName:bN,bySurn:bS};
      }

      const hLk=buildSqLookup(hPl),aLk=buildSqLookup(aPl);
      const hALk=buildSqLookup(hAl),aALk=buildSqLookup(aAl);
      const dedup=lk=>[...lk.byName.values()].filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i&&!p.noData).sort((a,b)=>(b.prob??-1)-(a.prob??-1));
      const mH=new Map([...hALk.byName,...hLk.byName]),mA=new Map([...aALk.byName,...aLk.byName]);
      const hP=dedup({byName:mH}),aP=dedup({byName:mA});
      document.getElementById('tab-sa').innerHTML=buildSeasonTab(hP,aP,fx,ht,at,{isIntl:false,cSeason,src:'club',hasLineups:false,hStarters:0,aStarters:0,blend,seasonChain:blend?[altSeason,selSeason]:[selSeason]});
      _saHomePlayers=hP; _saAwayPlayers=aP;
      renderMatchupsTab(fx,ht,at);
      renderTopPicksTab(fx,ht,at); updateCalibrationCheck(fx);
    }
  }
}
// Fetch club stats for a list of player objects.
// Concurrency is now governed by the global semaphore (_afConcurrent),
// which auto-scales to the user's plan after the first response.
// `onProgress(done, total)` is called after each player resolves — use it
// to update a loading indicator without blocking the fetch loop.
async function fetchPlayersThrottled(players, seasons, onProgress=null, opts={}){
  const blend = !!opts.blend; // 'Both' season mode — see fetchOne() below
  const results = new Array(players.length);
  const primarySeason = seasons[0];
  const fallbackSeasons = seasons.slice(1);
  const LS_PREFIX = 'banits_ps_';

  // Load from localStorage into memory cache at start of session (first call
  // only). Expiry is season-aware (lsTtlForSeason): a completed season's
  // stats are kept ~a year (they'll never change again — "next time this
  // team plays" reuses them instantly with zero API calls), the current
  // in-progress season is kept 24h (numbers shift after each matchday).
  if(!fetchPlayersThrottled._lsLoaded){
    fetchPlayersThrottled._lsLoaded = true;
    try{
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);
        if(!k?.startsWith(LS_PREFIX)) continue;
        const raw=localStorage.getItem(k);
        if(!raw) continue;
        const {t,d}=JSON.parse(raw);
        const cacheKey = k.slice(LS_PREFIX.length); // "${id}_${season}"
        const season = parseInt(cacheKey.slice(cacheKey.lastIndexOf('_')+1),10);
        if(Date.now()-t < lsTtlForSeason(season) && d){
          _playerStatsCache.set(cacheKey, d);
        } else {
          localStorage.removeItem(k); // expired
        }
      }
    }catch(e){}
  }

  // afFetchRetry(...) returning null is unambiguous: afFetchRaw() only ever
  // returns null on a genuine failure (non-2xx status, network/CORS
  // exception, or an API-Football `errors` payload) — a well-formed
  // response with genuinely no stats for that player/season still comes
  // back as a real object (e.g. `{response:[]}`), which extractDomesticStats
  // correctly turns into `stats:null` separately. So `failed` here means
  // "the request itself didn't go through", not "no stats found". As of
  // 2026-08-27 both cases are treated the same by fetchOne()'s caller (both
  // get one automatic retry) — `failed` is kept distinct here mainly so a
  // future caller that DOES want to tell the two apart still can.
  async function cachedFetch(id, season){
    const key = `${id}_${season}`;
    // In-memory cache (covers current session + pre-loaded from localStorage above)
    if(_playerStatsCache.has(key)) return {stats:_playerStatsCache.get(key), failed:false};
    // Fetch from API. Now that '2025'/'2026' modes are strict (single
    // season, no automatic fallback season — see the 2026-08-25 season
    // rework above), a season-fallback loop can no longer double as a
    // bonus retry budget the way it used to when every mode always tried
    // 2 seasons. Bumped from 1 retry to 3 here so a single season's worth
    // of genuine 429 recovery attempts (4, same as before: 2 seasons × 2
    // attempts) doesn't shrink just because there's only one season to try.
    const r = await afFetchRetry(`/players?id=${id}&season=${season}`, 3);
    if(r==='BREAKER') return {stats:null, failed:true};
    if(r===null) return {stats:null, failed:true}; // real fetch/API failure — worth retrying later
    const stats = extractDomesticStats(r?.response?.[0]);
    if(stats){
      // Only cache and persist successful results — nulls are retried next load
      _playerStatsCache.set(key, stats);
      try{ localStorage.setItem(LS_PREFIX+key, JSON.stringify({t:Date.now(),d:stats})); }catch(e){}
    }
    return {stats, failed:false}; // well-formed response — null here means genuinely no data, not retryable
  }

  async function fetchOne(lp){
    // cachedFetch() always resolves to {stats, failed} — a tripped breaker
    // folds in as failed:true, same as any other real fetch failure; the
    // outer second-pass loop already skips entirely while _breakerTripped,
    // so no special-casing needed here.
    //
    // 2026-08-27: retryable is now ALWAYS true whenever no season yielded
    // real stats — previously this only covered a genuine fetch failure
    // (real 429/network/http error), deliberately excluding a well-formed
    // "confirmed empty" response (see extractDomesticStats' apps===0 case
    // and the empty-statistics-array case) on the reasoning that a truly
    // empty response wouldn't change on an immediate retry. Reported live:
    // fringe/rotation players (backup keepers, academy call-ups in a cup
    // tie) sometimes come back blank on the first ask and DO have real
    // data on a second attempt — the same kind of intermittent
    // API-Football data-population gap already confirmed for lineup
    // formation/grid data this same day. The extra cost is bounded to
    // exactly one additional call per genuinely-blank player per match
    // view (the second-pass loop below never runs more than once), the
    // same cost profile the real-failure case already had.
    if(blend){
      // 'Both' season mode — fetch every season in the chain (each still
      // goes through the same per-season cache/localStorage as any other
      // mode, so this doesn't cost anything extra once warm) and combine
      // them into one steadier estimate instead of picking just one.
      const fetched = await Promise.all(seasons.map(s=>cachedFetch(lp.id,s)));
      const withStats = fetched.filter(f=>f.stats).map(f=>f.stats);
      if(!withStats.length){
        return placeholderPlayer(lp, true);
      }
      if(withStats.length===1) return withStats[0]; // only one season had data — nothing to blend
      return withStats.reduce((a,b)=>blendPlayerStats(a,b));
    }
    const quick = await cachedFetch(lp.id, primarySeason);
    if(quick.stats) return quick.stats;
    for(const s of fallbackSeasons){
      const fb = await cachedFetch(lp.id, s);
      if(fb.stats) return fb.stats;
    }
    return placeholderPlayer(lp, true);
  }

  // Fire all fetches simultaneously — the semaphore throttles to plan limits.
  // fetchOne() always resolves to either real stats or a placeholder object.
  let done = 0;
  const promises = players.map(async(lp,i)=>{
    results[i] = await fetchOne(lp);
    if(results[i] && lp.number) results[i] = {...results[i], number: lp.number};
    done++;
    if(onProgress) onProgress(done, players.length);
  });
  await Promise.all(promises);

  // Second pass — "right first time": a cold match view fires a genuinely
  // large burst (fixture context + referee/calibration history + every
  // starter/bench player's own stats call, all sharing one paced queue), and
  // a player whose call lands late in that burst can exhaust its single
  // 429-retry before the queue has thinned out — permanently showing "No
  // data found" for that page view, even though the player's stats are
  // really there. Previously the only way to recover was a full manual
  // reload, which worked because most other calls were now cache-warm and
  // competing for far fewer queue slots. Reproducing that same recovery
  // automatically: retry every player tagged retryable once the main batch
  // has drained and the queue is short again — as of 2026-08-27 that
  // includes a "confirmed empty" first response too (see fetchOne()'s note
  // above), not just a real fetch failure, since a fringe/rotation player
  // reported blank on the first ask can genuinely have real data on retry.
  const retryIdx = results.map((r,i)=>r?.retryable?i:-1).filter(i=>i>=0);
  if(retryIdx.length && !_breakerTripped){
    await new Promise(res=>setTimeout(res,500)); // let the queue fully drain first
    await Promise.all(retryIdx.map(async i=>{
      const r = await fetchOne(players[i]);
      results[i] = r;
      if(results[i] && players[i].number) results[i] = {...results[i], number: players[i].number};
    }));
    if(onProgress) onProgress(players.length, players.length);
  }

  return results;
}
fetchPlayersThrottled._lsLoaded = false;

// ── GLOBAL RATE LIMITER ───────────────────────────────────────
// API-Football rate-limits return 429 WITHOUT CORS headers, so fetch() throws
// before we can read the status — every such failure looked identical to a
// genuine network error and was never retried. We now (a) serialize ALL AF
// ═══════════════════════════════════════════════════════════════
// SECTION 7b — API RATE LIMITER (concurrency semaphore + real pacing)
// ═══════════════════════════════════════════════════════════════
// 2026-08-23 fix: the previous version of this limiter capped CONCURRENCY
// (max simultaneous in-flight requests) but had no minimum spacing between
// DISPATCHES. That works fine for slow/uncached requests, but a cache hit
// at the Cloudflare edge (or the browser's own HTTP cache) can resolve in
// well under 100ms — so N concurrent slots cycling that fast can burst to
// many times N requests/second, blowing straight through a per-minute
// quota even though "only N were ever in flight at once". This is the
// most likely real cause of the 429s being reported: concurrency ≠ rate.
//
// Fix: dispatches are now paced with a minimum gap (_afMinGapMs) derived
// from the plan's real per-minute limit (detected from response headers,
// same as before), in addition to the concurrency cap — so throughput is
// bounded by actual elapsed time, not by how fast responses happen to come
// back. Concurrency still allows some overlap for slow/uncached requests;
// pacing is what actually keeps requests/minute under the real limit.
//
// Plan limits (per API-Football docs):
//   Free:   10 req/min
//   Pro:   300 req/min
//   Ultra: 450 req/min
//   Mega:  900 req/min
//
// Conservative defaults (before any plan is detected from headers) assume
// the smallest realistic plan; both concurrency and gap widen once real
// headers are seen.
let _afConcurrent = 2;          // max simultaneous in-flight calls
let _afMinGapMs   = 300;        // minimum ms between DISPATCHES — this is what actually caps req/min, not concurrency
let _afLastDispatch = 0;
let _afActive = 0;              // currently in-flight calls
const _afPending = [];          // waiting calls

function _detectPlanFromHeaders(headers){
  // X-RateLimit-Limit reports per-minute limit — exposed in CORS if server allows
  try{
    const lim = parseInt(headers.get('X-RateLimit-Limit')||headers.get('x-ratelimit-limit')||'0');
    if(!lim) return;
    // +20% safety margin on the gap — better to run a little under the real
    // limit than to keep tripping 429s right at the edge of it.
    _afMinGapMs = Math.max(50, Math.ceil(60000 / lim * 1.2));
    if(lim >= 900) _afConcurrent = 6;
    else if(lim >= 450) _afConcurrent = 5;
    else if(lim >= 300) _afConcurrent = 4;
    else if(lim >= 60)  _afConcurrent = 2;
    else                _afConcurrent = 1; // free plan: 10/min
    console.log(`[AF] Plan detected: ${lim} req/min → ${_afConcurrent} concurrent slots, ${_afMinGapMs}ms min gap between dispatches`);
  }catch(e){}
}

function queueAfCall(fn){
  return new Promise((resolve,reject)=>{
    _afPending.push({fn,resolve,reject});
    _afDrain();
  });
}
function _afDrain(){
  if(_afActive >= _afConcurrent || !_afPending.length) return;
  const wait = _afLastDispatch + _afMinGapMs - Date.now();
  if(wait > 0){
    setTimeout(_afDrain, wait);
    return;
  }
  const {fn,resolve,reject} = _afPending.shift();
  _afLastDispatch = Date.now();
  _afActive++;
  fn().then(r=>{_afActive--;resolve(r);_afDrain();})
      .catch(e=>{_afActive--;reject(e);_afDrain();});
  // Try to schedule the next dispatch too — it'll self-pace via the gap
  // check above rather than firing immediately alongside this one.
  _afDrain();
}

// Cache /players?id=X&season=Y results for the session
const _playerStatsCache = new Map();

// ── CIRCUIT BREAKER ───────────────────────────────────────────
// Trips after BREAKER_THRESHOLD consecutive 429s — prevents silent
// multi-minute hangs when daily quota is exhausted.
let _consecutive429 = 0;
let _breakerTripped = false;
const BREAKER_THRESHOLD = 10; // high threshold: worker means 429s are rare transient events

function resetBreaker(){ _consecutive429=0; _breakerTripped=false; }


async function afFetchRetry(path, retries=0){
  if(_breakerTripped) return 'BREAKER';
  for(let attempt=0; attempt<=retries; attempt++){
    const r = await afFetchRaw(path);
    if(r !== '429'){
      if(r !== null) _consecutive429=0;
      return r;
    }
    _consecutive429++;
    if(_consecutive429 >= BREAKER_THRESHOLD){ _breakerTripped=true; return 'BREAKER'; }
    // Exponential backoff before retry
    await new Promise(res=>setTimeout(res, 400*(attempt+1)));
  }
  return null;
}

async function afFetchRaw(path){
  return queueAfCall(async()=>{
    try{
      _callCount++;
      document.getElementById('sb-calls').textContent=`API calls: ${_callCount}`;
      const r=await fetch(_apiBase()+path,{headers:_apiHdrs()});
      _detectPlanFromHeaders(r.headers);
      if(r.status===429) return '429';
      if(!r.ok)return null;
      const d=await r.json();
      if(d.errors&&Object.keys(d.errors).length)return null;
      return d;
    }catch(e){
      // CORS or network error — return null so the circuit breaker is not triggered.
      // Real 429 rate-limit responses are handled above via r.status===429.
      return null;
    }
  });
}

// Placeholder card for a player whose club stats couldn't be found in any
// season tried. `retryable` (as of 2026-08-27, always true when this is
// constructed via fetchOne()'s fallthrough — see its notes) tells
// fetchPlayersThrottled() to automatically retry this player once the
// initial burst has drained, instead of the user needing to manually
// reload the page to recover a player caught in a rate-limit spike OR one
// that simply came back blank on the first ask.
function placeholderPlayer(lp, retryable){
  const rawPos = lp.pos || lp.position; // lineup players use 'pos', squad players use 'position'
  return{
    id:lp.id, name:lp.name||'?', pos:normalizePos(rawPos), posL:posLabel(normalizePos(rawPos)),
    photo:lp.photo||null,
    fp90:0, tp90:0, yc:0, apps:0, mins:0, totalFouls:0, totalTackles:0,
    fd90:0, drb90:0, duelsW90:0, duelsT90:0, goals:0, assists:0,
    prob:null, srcLeague:null, srcTeam:null, srcSeason:null,
    lowConf:true, foulsMissing:false, noData:true, isClub:true, retryable:!!retryable,
  };
}

// Returns the most recent complete club season year (API-Football uses start year).
// e.g. in June 2026: 2025-26 season → season=2025
function lastClubSeason(){
  const now=new Date();
  const y=now.getFullYear();
  const m=now.getMonth(); // 0=Jan … 11=Dec
  // New club season starts ~August. Before August = last year's season is most recent complete.
  return m<7 ? y-1 : y; // season starts August (m=7), e.g. Aug 2026 → season 2026 (2026/27)
}

// For a player fetched via /players?id={id}, extract their primary domestic league stats.
// Priority order:
//   1. Main domestic leagues (PL, Championship, La Liga etc.) — ANY appearances, even 0
//      This ensures Championship beats League Cup even when Championship = 0 apps so far
//   2. Other domestic non-international leagues — only if ≥5 apps (cups rarely have 5+)
//   3. null — player has no meaningful domestic data for this season
function extractDomesticStats(pData){
  if(!pData?.player||!pData.statistics?.length) return null;
  const p=pData.player;

  // Pass 1 — main domestic leagues (cups excluded from this set)
  // Take the main-league row with most appearances; 0-app rows are valid if it's the player's league
  const mainRows=pData.statistics
    .filter(s=>MAIN_LEAGUE_IDS.has(s.league?.id))
    .sort((a,b)=>(b.games?.appearences||0)-(a.games?.appearences||0));

  // Pass 2 — any non-international domestic league with ≥5 apps as fallback
  // This catches players in smaller leagues not in MAIN_LEAGUE_IDS.
  // Cups almost never reach 5 apps in a season so this naturally excludes them.
  const fallbackRows=mainRows.length===0
    ? pData.statistics
        .filter(s=>!INTL_LEAGUES.has(s.league?.id)&&(s.games?.appearences||0)>=1)
        .sort((a,b)=>(b.games?.appearences||0)-(a.games?.appearences||0))
    : [];

  const clubRows=mainRows.length>0?mainRows:fallbackRows;
  if(!clubRows.length) return null; // only cup data or no domestic data at all

  const st=clubRows[0];
  const apps=st.games?.appearences||0;
  if(apps===0) return null; // player is in the right league but hasn't played yet
  const mins=Math.max(st.games?.minutes||apps*70,1);
  const fc=st.fouls?.committed||0;
  const fd=st.fouls?.drawn||0;
  const tk=st.tackles?.total||0;
  const yc=st.cards?.yellow||0;
  const drb=st.dribbles?.attempts||0;
  const duelsW=st.duels?.won||0, duelsT=st.duels?.total||0;
  const pos=normalizePos(st.games?.position);
  const fp90=fc/mins*90;
  const foulsMissing=(pos!=='G')&&apps>=4&&fc===0&&tk===0;
  return{
    id:p.id, name:p.name, pos, posL:posLabel(pos), photo:p.photo||null,
    fp90, tp90:tk/mins*90, yc, apps, mins,
    totalFouls:fc, totalTackles:tk,
    fd90:fd/mins*90, drb90:drb/mins*90, duelsW90:duelsW/mins*90, duelsT90:duelsT/mins*90,
    goals:st.goals?.total||0, assists:st.goals?.assists||0,
    prob:foulsMissing?null:cardProb(fp90,pos,yc,apps),
    srcLeague:st.league?.name, srcTeam:st.team?.name, srcSeason:st.league?.season,
    lowConf:apps<8, foulsMissing, isClub:true,
  };
}

// Combine two seasons' worth of a player's stats into one steadier estimate
// (the 'Both' season mode). fp90/tp90 are recomputed exactly from the two
// seasons' raw totals (totalFouls/totalTackles/mins are true counts, so
// summing them is exact). fd90/drb90/duelsW90/duelsT90 only ever exist as
// per-90 rates (no raw counts kept), so those are combined as a
// minutes-weighted average — mathematically identical to summing the raw
// counts and dividing by combined minutes (rate = raw/mins*90, so
// raw = rate*mins/90; weighting by minutes recovers the same combined rate
// without needing the raw counts at all). A season with 0 minutes
// contributes 0 weight, so blending a real season with an empty one
// degrades cleanly to just the real one.
function blendPlayerStats(a,b){
  const mins = (a.mins||0)+(b.mins||0);
  const wA = mins ? (a.mins||0)/mins : 0.5, wB = mins ? (b.mins||0)/mins : 0.5;
  const wAvg = (ra,rb) => (ra||0)*wA + (rb||0)*wB;
  const apps = (a.apps||0)+(b.apps||0);
  const totalFouls = (a.totalFouls||0)+(b.totalFouls||0);
  const totalTackles = (a.totalTackles||0)+(b.totalTackles||0);
  const yc = (a.yc||0)+(b.yc||0);
  const fp90 = mins ? totalFouls/mins*90 : 0;
  const tp90 = mins ? totalTackles/mins*90 : 0;
  const pos = (b.mins||0)>=(a.mins||0) ? (b.pos||a.pos) : (a.pos||b.pos);
  const foulsMissing = pos!=='G' && apps>=4 && totalFouls===0 && totalTackles===0;
  const newer = (b.srcSeason||0)>=(a.srcSeason||0) ? b : a;
  const older = newer===a ? b : a;
  return{
    id:a.id||b.id, name:a.name||b.name, pos, posL:posLabel(pos), photo:a.photo||b.photo||null,
    fp90, tp90, yc, apps, mins,
    totalFouls, totalTackles,
    fd90:wAvg(a.fd90,b.fd90), drb90:wAvg(a.drb90,b.drb90),
    duelsW90:wAvg(a.duelsW90,b.duelsW90), duelsT90:wAvg(a.duelsT90,b.duelsT90),
    goals:(a.goals||0)+(b.goals||0), assists:(a.assists||0)+(b.assists||0),
    prob:foulsMissing?null:cardProb(fp90,pos,yc,apps),
    srcLeague:newer.srcLeague||older.srcLeague, srcTeam:newer.srcTeam||older.srcTeam,
    srcSeason:'both', srcSeasons:[older.srcSeason,newer.srcSeason].filter(s=>s!=null),
    lowConf:apps<8, foulsMissing, isClub:true,
  };
}

// Normalise position strings from either format ("Midfielder" or "M")
function normalizePos(pos){
  if(!pos) return '?';
  const p=pos.toLowerCase();
  if(p==='g'||p.startsWith('goal')) return 'G';
  if(p==='d'||p.startsWith('def')) return 'D';
  if(p==='m'||p.startsWith('mid')) return 'M';
  if(p==='f'||p.startsWith('att')||p.startsWith('for')) return 'F';
  return '?';
}

// For club matches, build a season fallback chain from the fixture's league.season.
// Capped at 2 to avoid excessive API calls (was generating 4 tries × 2 teams = 8 calls).
function buildSeasonChain(leagueSeason){
  const current=new Date().getFullYear();
  const chain=[];
  if(leagueSeason) chain.push(leagueSeason);
  const fallback=(!leagueSeason||leagueSeason===current)?current-1:current;
  if(!chain.includes(fallback)) chain.push(fallback);
  return chain;
}

async function loadOddsTab(fid,fx,ht,at){
  const[pd,od]=await Promise.all([
    afFetch(`/predictions?fixture=${fid}`),
    afFetch(`/odds?fixture=${fid}&bookmaker=6`),
  ]);
  document.getElementById('tab-od').innerHTML=buildOddsTab(pd,od,fx,ht,at);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 7 — MATCH HEADER
// ═══════════════════════════════════════════════════════════════
function buildHeader(fx,ht,at){
  const f=fx.fixture,t=fx.teams,g=fx.goals;
  const live=isLive(f.status.short),fin=isFinal(f.status.short);
  const sc=g.home!==null?`${g.home} &ndash; ${g.away}`:'&ndash;';
  const stDisp=live?(f.status.short==='HT'?'Half Time':`${f.status.elapsed}' — LIVE`):
               fin?'Full Time':fmtTime(f.date);
  // Team colour gradient: home bleeds from left, away from right
  function h2r(hex,a){const r=(hex||'#0047b5').replace('#','').match(/.{2}/g)||['0','47','b5'];return`rgba(${r.map(x=>parseInt(x,16)).join(',')},${a})`;}
  const hGrad=h2r(ht.c,0.14);
  const aGrad=h2r(at.c,0.14);
  return`<div>
    <h1 class="sr-only">${t.home.name} vs ${t.away.name}${live?' — live':fin?' — final':''}</h1>
    <!-- Team colour gradient overlay -->
    <div class="mv-hdr-grad" style="background:linear-gradient(90deg,${hGrad} 0%,transparent 40%,transparent 60%,${aGrad} 100%)"></div>
    <div class="mv-hdr-top-bar" style="background:linear-gradient(90deg,${ht.c},${at.c})"></div>
    <div class="mh-comp">
      <button class="btn-back" onclick="backFromMatch()" title="Back"><i class="ti ti-arrow-left"></i> Back</button>
      <div class="sb-hamburger" onclick="openSidebar()" title="Open menu" role="button" tabindex="0" onkeydown="_kbActivate(event)"><i class="ti ti-menu-2"></i> Menu</div>
      <i class="ti ti-tournament"></i>${fx.league.name}
      ${fx.league.round?'— '+fx.league.round:''}
      ${live?'<span class="chip chip-live">LIVE</span>':fin?'<span class="chip chip-ft">FT</span>':'<span class="chip chip-ns">'+fmtTime(f.date)+'</span>'}
      <button class="btn-back" style="margin-left:auto" onclick="copyMatchLink(${f.id},this)" title="Copy a shareable link to this match"><i class="ti ti-share"></i> Share</button>
    </div>
    <div class="mh-scores">
      <div class="mh-team-h">
        <div class="mh-top-row">
          ${badge(t.home.logo,'lg',t.home.name)}
          <div class="mh-abbr" style="color:${ht.c}">${ht.a}</div>
        </div>
        <div class="mh-nm">${t.home.name} ${favStarBtn(t.home.id,t.home.name)}</div>
      </div>
      <div class="mh-ctr">
        <div class="mh-sc${live?' live-sc':''}" style="color:${live?'var(--high)':fin?'var(--text)':'var(--muted)'}">${sc}</div>
        <div class="mh-st${live?' live-txt':''}">${stDisp}</div>
      </div>
      <div class="mh-team-a">
        <div class="mh-top-row">
          ${badge(t.away.logo,'lg',t.away.name)}
          <div class="mh-abbr" style="color:${at.c}">${at.a}</div>
        </div>
        <div class="mh-nm">${favStarBtn(t.away.id,t.away.name)} ${t.away.name}</div>
      </div>
    </div>
    <!-- Form strips: filled async by loadMatchContext -->
    <div class="mh-ctx">
      <div class="mh-ctx-team">
        <span class="mh-ctx-label" style="color:${ht.c}">${ht.a}</span>
        <div id="ctx-form-h" class="form-strip">
          <div class="skel skel-line" style="width:90px"></div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        ${f.referee?`<span class="ref-badge"><i class="ti ti-whistle" style="font-size:10px"></i>${f.referee}</span>`:''}
      </div>
      <div class="mh-ctx-team" style="flex-direction:row-reverse">
        <span class="mh-ctx-label" style="color:${at.c};text-align:right">${at.a}</span>
        <div id="ctx-form-a" class="form-strip" style="flex-direction:row-reverse">
          <div class="skel skel-line" style="width:90px"></div>
        </div>
      </div>
    </div>
    <div class="mh-info">
      ${f.venue?.name?`<span><i class="ti ti-map-pin" style="font-size:9px;margin-right:2px"></i>${f.venue.name}${f.venue.city?', '+f.venue.city:''}</span>`:''}
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 8 — OVERVIEW TAB (events + team stats)
// ═══════════════════════════════════════════════════════════════
function evIcon(ev){
  const[t,d]=[ev.type,ev.detail];
  if(t==='Goal'){
    if(d==='Own Goal')return'<span style="color:#f97316">⚽</span>';
    if(d==='Penalty')return'<span style="color:var(--low)">⚽</span>';
    return'<span style="color:#60a5fa">⚽</span>';
  }
  if(t==='Card')return d?.includes('Yellow')?'🟨':d?.includes('Red')?'🟥':'🟨';
  if(t==='subst')return'<span style="color:var(--muted);font-size:12px">↕</span>';
  if(t==='Var')return'<span style="font-size:10px;color:var(--blue);font-weight:700">VAR</span>';
  return'<span style="color:var(--dim)">•</span>';
}

function buildOverviewTab(fx,ht,at){
  const events=fx.events||[];
  const stats=fx.statistics||[];
  const hId=fx.teams.home.id;
  let h='';

  // Match context panel (form + standings filled async)
  if(!INTL_LEAGUES.has(fx.league?.id)){
    h+=`<div class="ctx-panel">
      <div class="ctx-sec-hd"><i class="ti ti-table" style="font-size:11px"></i> League table</div>
      <div id="ctx-standings"><div class="skel skel-line" style="width:100%;height:36px;margin-bottom:0"></div></div>
    </div>
    <div id="ctx-h2h"></div>`;
  }

  h+='<div class="two-col">';

  // Events
  h+=`<div><h2 class="stitle"><i class="ti ti-timeline-event"></i>Match events</h2>`;
  if(events.length){
    h+='<div class="ev-list">';
    for(const ev of events){
      const isH=ev.team.id===hId;
      const col=isH?ht.c:at.c;
      const el=ev.time.extra?`${ev.time.elapsed}+${ev.time.extra}`:String(ev.time.elapsed);
      const teamAbbr=isH?ht.a:at.a;
      let subLine='';
      if(ev.type==='subst'&&ev.assist?.name)subLine=`<div class="ev-sub"><span style="color:var(--low)">↑</span> ${ev.assist.name}</div>`;
      else if(ev.assist?.name)subLine=`<div class="ev-sub">Assist: ${ev.assist.name}</div>`;
      else if(ev.detail&&ev.detail!=='Normal Goal'&&ev.detail!==ev.type)subLine=`<div class="ev-sub">${ev.detail}</div>`;
      h+=`<div class="ev-item">
        <span class="ev-t" style="color:${col}">${el}'</span>
        <span class="ev-ico">${evIcon(ev)}</span>
        <div class="ev-det">
          <div class="ev-pl" style="color:${col}">${ev.player?.name||'?'}</div>
          ${subLine}
        </div>
        <span class="ev-tm">${teamAbbr}</span>
      </div>`;
    }
    h+='</div>';
  }else{
    h+=`<div class="no-data"><i class="ti ti-clock"></i><strong>No events recorded yet</strong></div>`;
  }

  // Card timing split — first half vs second half, from this match's own
  // events (only meaningful once the match has kicked off; this is
  // descriptive of what already happened, not part of the pre-match
  // probability model).
  const cardEvents = events.filter(e=>e.type==='Card');
  if(cardEvents.length){
    const bucket = (teamId) => {
      const evs = cardEvents.filter(e=>e.team?.id===teamId);
      const first = evs.filter(e=>(e.time?.elapsed||0)<=45).length;
      const second = evs.length - first;
      return {first, second};
    };
    const hB = bucket(hId), aB = bucket(fx.teams.away.id);
    const splitRow = (abbr, col, b) => `<div class="ct-split-row">
      <span class="ct-split-team" style="color:${col}">${abbr}</span>
      <span class="ct-split-bars">
        <span class="ct-split-bar ct-split-1h" style="flex:${b.first||0.001}"></span>
        <span class="ct-split-bar ct-split-2h" style="flex:${b.second||0.001}"></span>
      </span>
      <span class="ct-split-nums">${b.first} 1H · ${b.second} 2H</span>
    </div>`;
    h+=`<div class="ct-split">
      <div class="ct-split-hd"><i class="ti ti-clock" style="font-size:11px"></i> Card timing <span style="color:var(--dim);font-weight:400;text-transform:none;letter-spacing:0">— before / after half-time</span></div>
      ${splitRow(ht.a, ht.c, hB)}
      ${splitRow(at.a, at.c, aB)}
    </div>`;
  }
  h+='</div>';

  // Team stats
  h+=`<div><h2 class="stitle"><i class="ti ti-chart-bar"></i>Team statistics</h2>`;
  if(stats.length>=2){
    const hSt=stats.find(s=>s.team.id===hId)?.statistics||[];
    const aSt=stats.find(s=>s.team.id!==hId)?.statistics||[];
    const gv=(arr,type)=>{const s=arr.find(x=>x.type===type);if(!s||s.value===null)return null;return typeof s.value==='string'&&s.value.endsWith('%')?parseFloat(s.value):Number(s.value)||0;};
    const ROWS=[
      {k:'Ball Possession',l:'Ball possession',pct:true},
      {k:'Total Shots',l:'Total shots'},{k:'Shots on Goal',l:'Shots on target'},
      {k:'Fouls',l:'Fouls'},{k:'Yellow Cards',l:'Yellow cards'},
      {k:'Corner Kicks',l:'Corners'},{k:'Offsides',l:'Offsides'},
      {k:'Passes accurate',l:'Accurate passes'},
    ];
    for(const{k,l,pct}of ROWS){
      const hv=gv(hSt,k),av=gv(aSt,k);if(hv===null&&av===null)continue;
      const hn=hv||0,an=av||0,tot=hn+an||1;
      const hp=pct?hn:hn/tot*100,ap=pct?an:an/tot*100;
      h+=`<div class="stat-row">
        <div class="stat-lbl"><span>${l}</span><span><span class="sv" style="color:${ht.c}">${hv??'-'}</span>&nbsp;·&nbsp;<span class="sv" style="color:${at.c}">${av??'-'}</span></span></div>
        <div class="stat-track">
          <div class="stat-h" style="width:${hp}%;background:${ht.c}"></div>
          <div class="stat-a" style="width:${ap}%;background:${at.c}"></div>
        </div>
      </div>`;
    }
  }else{
    h+=`<div class="no-data"><i class="ti ti-chart-bar"></i><strong>Team stats available after kickoff</strong></div>`;
  }
  h+='</div></div>';
  return h;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 9 — LINEUPS TAB
// ═══════════════════════════════════════════════════════════════
function gridXY(grid,formation){
  if(!grid)return null;
  const[r,c]=grid.split(':').map(Number);
  const rows=[1,...(formation||'4-4-2').split('-').map(Number)];
  const totalRows=rows.length;
  const yPct=85-((r-1)/(totalRows-1||1))*73;
  const rowCount=rows[r-1]||1;
  if(rowCount===1) return{x:50,y:yPct};
  // Narrower horizontal spread for rows with fewer players (e.g. a double
  // pivot of 2 CMs) and wider spread for rows with more players (back four,
  // wide midfield) — keeps central roles visually central instead of
  // spreading 2 players all the way to the touchlines.
  const halfWidth=Math.min(8+(rowCount-1)*10,40);
  const xPct=50-halfWidth+((c-1)/(rowCount-1))*(halfWidth*2);
  return{x:xPct,y:yPct};
}

// Build a name→stats lookup from season analysis results.
// Matches on last name since lineup names ("L. Messi") vs season names ("Lionel Messi") can differ.
function statsLookup(players){
  const map={};
  for(const p of players||[]){
    if(!p||p.noData)continue;
    const last=p.name.split(' ').pop().toLowerCase();
    map[last]=p;
    map[p.name.toLowerCase()]=p;
  }
  return map;
}

// Like statsLookup but includes noData players — photo is returned by
// /players/squads regardless of whether club stats were found.
function photoLookup(players){
  const map={};
  for(const p of players||[]){
    if(!p)continue;
    const last=p.name.split(' ').pop().toLowerCase();
    map[last]=p;
    map[p.name.toLowerCase()]=p;
  }
  return map;
}

function photoFor(name, lookup){
  if(!lookup)return null;
  const p = lookup[name.toLowerCase()] || lookup[name.split(' ').pop().toLowerCase()];
  return p?.photo || null;
}

// Returns {value, label, color} for the current overlay mode, or null if no data.
function pitchStatFor(name, lookup){
  if(!lookup)return null;
  const p = lookup[name.toLowerCase()] || lookup[name.split(' ').pop().toLowerCase()];
  if(!p || p.noData) return null;
  if(_pitchStatMode==='cards'){
    if(p.foulsMissing||p.prob===null)return null;
    const pct=Math.round(p.prob*100);
    return{value:pct+'%',color:probBarColor(pct)};
  }
  if(_pitchStatMode==='fouls'){
    if(p.foulsMissing)return null;
    return{value:p.fp90.toFixed(1),color:p.fp90>=3?'var(--high)':p.fp90>=1.5?'var(--med)':'var(--low)'};
  }
  if(_pitchStatMode==='tackles'){
    return{value:p.tp90.toFixed(1),color:'var(--blue)'};
  }
  return null;
}

// Build a name → card/sub events lookup from fixture events
// Returns map of player name → {yc, rc, sub:{out,time,repl}}
function eventsLookup(events){
  const map={};
  for(const ev of (events||[])){
    const pname=ev.player?.name||'';
    const aname=ev.assist?.name||'';
    if(!pname)continue;
    if(!map[pname])map[pname]={yc:0,rc:0,sub:null};
    if(ev.type==='Card'){
      if(ev.detail==='Yellow Card'||ev.detail==='Yellow+Red Card')map[pname].yc++;
      if(ev.detail==='Red Card'||ev.detail==='Yellow+Red Card')map[pname].rc++;
    }
    if(ev.type==='subst'){
      const t=ev.time.extra?`${ev.time.elapsed}+${ev.time.extra}'`:ev.time.elapsed+"'";
      if(!map[pname])map[pname]={yc:0,rc:0,sub:null};
      map[pname].sub={out:true,time:t,repl:aname};
      if(aname){
        if(!map[aname])map[aname]={yc:0,rc:0,sub:null};
        map[aname].sub={in:true,time:t,repl:pname};
      }
    }
  }
  return map;
}

function buildPitch(lineup,subMap,col,lookup,photoLk,evLk){
  const starters=lineup.startXI||[];
  const subs=lineup.substitutes||[];
  const formation=lineup.formation||'4-4-2';

  // Cards icon HTML
  function cardBadges(evData){
    if(!evData)return'';
    let html='';
    if(evData.rc)html+=`<span class="pp-card pp-card-r">🟥</span>`;
    else if(evData.yc===2)html+=`<span class="pp-card pp-card-y2">🟨🟥</span>`;
    else if(evData.yc===1)html+=`<span class="pp-card pp-card-y">🟨</span>`;
    return html;
  }

  // Starters on pitch
  const starterHtml = starters.map(p=>{
    const name=p.player?.name||'?';
    const num=p.player?.number||'';
    const xy=gridXY(p.player?.grid,formation)||{x:50,y:50};
    const sub=subMap[name];
    const ev=evLk?.[name];
    const sOff=ev?.sub?.out || !!sub?.out;
    const subTime=ev?.sub?.time || (sub?.time?sub.time+"'":'');
    const subRepl=ev?.sub?.repl || sub?.replacedBy || '';
    const lastName=name.split(' ').pop()||name;
    const stat=pitchStatFor(name,lookup);
    const photo=photoFor(name,photoLk);
    return`<div class="pp" style="left:${xy.x}%;top:${xy.y}%">
      <div class="pp-circ${sOff?' sub-off':''}" style="${sOff?'':'border-color:'+col+';'}">
        <span class="pp-num">${num}</span>
        ${photo?`<img src="${photo}" alt="" class="pp-photo" loading="lazy" onerror="this.remove()">`:''}
        ${num?`<span class="pp-kit-num">${num}</span>`:''}
        ${sOff?`<span class="pp-badge pp-badge-sub">↓${subTime}</span>`:''}
      </div>
      ${cardBadges(ev)}
      <div class="pp-name">${lastName}</div>
      ${stat?`<div class="pp-stat" style="color:${stat.color}">${stat.value}</div>`:''}
    </div>`;
  }).join('');

  // Substitutes shown in a row below the pitch
  const subRows = subs.map(p=>{
    const name=p.player?.name||'?';
    const num=p.player?.number||'';
    const pos=p.player?.pos||'';
    const ev=evLk?.[name];
    const cameon=ev?.sub?.in || !!subMap[name]?.in;
    const subTime=ev?.sub?.time || (subMap[name]?.time?subMap[name].time+"'":'');
    const subRepl=ev?.sub?.repl || subMap[name]?.replacementOf||'';
    const photo=photoFor(name,photoLk);
    return`<div class="pp-sub-row${cameon?' pp-sub-on':''}">
      <div class="pp-sub-num" style="color:${col}">${num}</div>
      ${photo?`<img src="${photo}" alt="" class="pp-sub-photo" loading="lazy" onerror="this.remove()">`
             :`<div class="pp-sub-photo pp-sub-nophoto"><i class="ti ti-user" style="font-size:10px"></i></div>`}
      <div class="pp-sub-info">
        <span class="pp-sub-name">${name}</span>
        <span class="pp-sub-pos pos-${normalizePos(pos)}">${pos||'?'}</span>
      </div>
      ${cameon
        ?`<span class="pp-sub-arrow pp-sub-on-arr">↑ <b>${subTime}</b></span>`
        :`<span class="pp-sub-arrow pp-sub-off-arr" style="opacity:.4">–</span>`}
      ${cardBadges(ev)}
    </div>`;
  }).join('');

  return`<div class="pitch">
    <div class="pitch-box18 pitch-box18-top"></div>
    <div class="pitch-box6 pitch-box6-top"></div>
    <div class="pitch-arc pitch-arc-top"></div>
    <div class="pitch-box18 pitch-box18-bot"></div>
    <div class="pitch-box6 pitch-box6-bot"></div>
    <div class="pitch-arc pitch-arc-bot"></div>
    ${starterHtml}
  </div>
  ${subs.length?`<div class="pp-subs-panel">
    <div class="pp-subs-hd">Substitutes</div>
    ${subRows}
  </div>`:''}`;
}

// Switch pitch overlay mode (cards/fouls/tackles) and re-render lineups tab in place.
function setPitchStat(mode,btn){
  _pitchStatMode=mode;
  document.querySelectorAll('.pitch-stat-btn').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  refreshPitchOverlay();
}

// Re-render the lineups tab using cached fixture data (no new API call).
function refreshPitchOverlay(){
  if(!_lastFx)return;
  const tab=document.getElementById('tab-lu');
  if(tab && tab.innerHTML) tab.innerHTML=buildLineupsTab(_lastFx,_lastHt,_lastAt);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 12b — MATCHUPS TAB
// ═══════════════════════════════════════════════════════════════
// Identify likely "duel" pairings: attacking players with high take-on/duel
// volume vs opposition defenders/midfielders with high foul rates. These are
// the on-pitch pairings most likely to produce fouls and cards, even though
// we don't have actual marking assignments — this is a heuristic based on role
// and season tendencies, not a tactical prediction.
function renderMatchupsTab(fx,ht,at){
  const tab=document.getElementById('tab-mu');
  if(!tab)return;
  tab.innerHTML=buildMatchupsTab(fx,ht,at);
}

// An "attacking threat" is a forward/wide midfielder who carries the ball —
// ranked by take-ons (dribble attempts) per 90, with duels/90 as tiebreak.
function attackingThreats(players){
  return (players||[])
    .filter(p=>!p.noData && (p.pos==='F'||p.pos==='M') && (p.drb90>0||p.duelsT90>0))
    .sort((a,b)=>(b.drb90 - a.drb90) || (b.duelsT90 - a.duelsT90))
    .slice(0,4);
}

// A "foul-prone defender" is a defender/defensive midfielder ranked by FC/90.
function foulProneDefenders(players){
  return (players||[])
    .filter(p=>!p.noData && !p.foulsMissing && (p.pos==='D'||p.pos==='M') && p.fp90>0)
    .sort((a,b)=>b.fp90-a.fp90)
    .slice(0,4);
}

// Simple qualitative risk tier — deliberately not a fabricated percentage.
// Combines how often the attacker draws fouls/engages in duels with how
// often the defender commits fouls. Tiers reflect "worth watching" not
// a precise probability (see earlier discussion on small-sample precision).
function matchupTier(atk, def){
  const atkScore = atk.drb90 + atk.duelsT90*0.3; // take-ons + general duel volume
  const defScore = def.fp90;
  if(defScore>=2.2 && atkScore>=3) return{label:'High',cls:'hi'};
  if(defScore>=1.4 && atkScore>=1.8) return{label:'Medium',cls:'md'};
  return{label:'Low',cls:'lo'};
}

function buildMatchupCard(atk, def, atkCol, defCol){
  const tier = matchupTier(atk,def);
  return`<div class="mu-card">
    <div class="mu-side">
      <div class="mu-role">Attacker</div>
      <div class="mu-name" style="color:${atkCol}">${atk.name}</div>
      <div class="mu-pos pos-${atk.pos}">${atk.posL}</div>
      <div class="mu-stat-row">
        <span>Take-ons <b>${atk.drb90.toFixed(1)}</b>/90</span>
        <span>Duels <b>${atk.duelsT90.toFixed(1)}</b>/90</span>
        <span>FD <b>${atk.fd90.toFixed(1)}</b>/90</span>
      </div>
    </div>
    <div class="mu-vs">
      <i class="ti ti-swords"></i>
      <div class="mu-tier ${tier.cls}">${tier.label}</div>
    </div>
    <div class="mu-side mu-side-r">
      <div class="mu-role">Defender</div>
      <div class="mu-name" style="color:${defCol}">${def.name}</div>
      <div class="mu-pos pos-${def.pos}">${def.posL}</div>
      <div class="mu-stat-row">
        <span>FC <b>${def.fp90.toFixed(1)}</b>/90</span>
        <span>Tkl <b>${def.tp90.toFixed(1)}</b>/90</span>
        <span>YC <b>${def.yc}/${def.apps}</b></span>
      </div>
    </div>
  </div>`;
}

function buildMatchupSection(title, attackers, defenders, atkCol, defCol){
  if(!attackers.length || !defenders.length){
    return`<div class="no-data" style="padding:20px">
      <i class="ti ti-swords"></i>
      <strong>${title}</strong><br>Not enough data to identify matchups — need both take-on data for attackers and foul data for defenders.
    </div>`;
  }
  const n = Math.min(attackers.length, defenders.length, 3);
  let h = `<div class="mu-sec-hd">${title}</div>`;
  for(let i=0;i<n;i++){
    h += buildMatchupCard(attackers[i], defenders[i], atkCol, defCol);
  }
  return h;
}

function buildMatchupsTab(fx,ht,at){
  if(!_saHomePlayers.length && !_saAwayPlayers.length){
    return`<div class="no-data" style="padding:40px 20px">
      <i class="ti ti-swords"></i>
      <strong>Waiting for season analysis</strong><br>
      Matchups are derived from the same club-stat data shown in the Analysis tab. Open the Analysis tab first, or wait for it to finish loading.
    </div>`;
  }

  const homeAtk = attackingThreats(_saHomePlayers);
  const awayDef = foulProneDefenders(_saAwayPlayers);
  const awayAtk = attackingThreats(_saAwayPlayers);
  const homeDef = foulProneDefenders(_saHomePlayers);

  return`<div class="tip-box">
    <strong style="color:var(--violet)">ℹ How to read this</strong> — these pairings are a heuristic based on player role and season tendencies, not actual marking assignments (tactical/marking data isn't available). An attacker ranked by take-ons (dribble attempts/90) is paired against the opposition's most foul-prone defender/midfielder by role. The "tier" reflects how often this type of matchup tends to produce fouls — not a probability of a specific event.
  </div>
  <h2 class="stitle"><i class="ti ti-swords"></i>Likely duel matchups <span class="chip chip-af" style="margin-left:6px">Heuristic</span></h2>
  <div class="mu-grid">
    <div>${buildMatchupSection(`${fx.teams.home.name} attack vs ${fx.teams.away.name} defence`, homeAtk, awayDef, ht.c, at.c)}</div>
    <div>${buildMatchupSection(`${fx.teams.away.name} attack vs ${fx.teams.home.name} defence`, awayAtk, homeDef, at.c, ht.c)}</div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 12c — TOP PICKS TAB
// ═══════════════════════════════════════════════════════════════
// Poisson helpers: fp90 (fouls per 90 mins) IS a Poisson rate parameter λ.
// P(X >= k) = 1 - P(X < k) = 1 - sum_{i=0}^{k-1} e^-λ λ^i / i!
function poissonPMF(lambda,k){
  let fact=1; for(let i=2;i<=k;i++)fact*=i;
  return Math.exp(-lambda)*Math.pow(lambda,k)/fact;
}
function poissonAtLeast(lambda,k){
  let cdf=0;
  for(let i=0;i<k;i++) cdf+=poissonPMF(lambda,i);
  return Math.min(Math.max(1-cdf,0),0.999);
}

// Filter season-analysis players down to confirmed starters using the fixture's
// lineup data, matching by full name or surname (lineup vs squad naming differs).
// Returns null if lineups aren't available or the match rate is too low to trust.
// Returns {starters, bench} when lineups are confirmed, or null if no match.
// bench = squad players whose names DON'T appear in startXI but ARE in the
// lineup's substitutes list (named subs only — unused subs not listed).
function filterToConfirmedStarters(players, lineupTeam){
  if(!lineupTeam?.startXI?.length) return null;
  const startXI = lineupTeam.startXI.map(p=>p.player?.name||'').filter(Boolean);
  const subList = (lineupTeam.substitutes||[]).map(p=>p.player?.name||'').filter(Boolean);
  const allNamed = new Set([...startXI,...subList]);
  const fullNames = new Set(startXI.map(n=>n.toLowerCase()));
  const surnames  = new Set(startXI.map(n=>n.split(' ').pop().toLowerCase()));
  const subFullNames = new Set(subList.map(n=>n.toLowerCase()));
  const subSurnames  = new Set(subList.map(n=>n.split(' ').pop().toLowerCase()));

  const starters=[], bench=[];
  for(const pl of players){
    const ln=pl.name.toLowerCase(), ls=pl.name.split(' ').pop().toLowerCase();
    if(fullNames.has(ln)||surnames.has(ls)) starters.push({...pl,xistatus:'starter'});
    else if(subFullNames.has(ln)||subSurnames.has(ls)) bench.push({...pl,xistatus:'bench'});
  }
  // Require reasonable match rate
  if(starters.length < Math.min(6, startXI.length*0.5)) return null;
  return{starters,bench};
}

function tpProbCls(p){return p>=0.5?'hi':p>=0.25?'md':'lo'}

function buildBookingPickRow(p, col, rank){
  const pct = Math.round(p.prob*100);
  const posFactor = {'G':0.2,'D':1.4,'M':1.0,'F':0.65}[p.pos]||1.0;
  const photoImg = p.photo?`<img src="${p.photo}" alt="" class="tp-photo" loading="lazy" onerror="this.remove()">`:'';
  const srcTxt = p.srcTeam||p.srcLeague
    ? `${p.srcTeam||''}${p.srcTeam&&p.srcLeague?' · ':''}${p.srcLeague||''}`
    : '';
  return`<div class="tp-row">
    <div class="tp-row-top">
      <span class="tp-rank">#${rank}</span>
      ${photoImg}
      <div class="tp-info">
        <span class="tp-name" style="color:${col}">${p.name}</span>
        <span class="tp-pos pos-${p.pos}">${p.posL}</span>
        <span class="tp-team-lbl">${p.teamName}</span>
      </div>
      <span class="tp-pct ${probColor(pct)}">${pct}%</span>
    </div>
    <div class="tp-meta">
      <span>FC/90 <b>${p.fp90.toFixed(1)}</b></span>
      <span>Tkl/90 <b>${p.tp90.toFixed(1)}</b></span>
      <span>YC <b>${p.yc}/${p.apps}</b> apps</span>
      <span>Pos. factor <b>×${posFactor}</b></span>
      ${srcTxt?`<span class="tp-src">${srcTxt}</span>`:''}
    </div>
  </div>`;
}

function buildFoulPickRow(p, col, rank){
  const p1=poissonAtLeast(p.fp90,1), p2=poissonAtLeast(p.fp90,2), p3=poissonAtLeast(p.fp90,3);
  const photoImg = p.photo?`<img src="${p.photo}" alt="" class="tp-photo-sm" loading="lazy" onerror="this.remove()">`:'<span></span>';
  return`<div class="tp-foul-row">
    <span class="tp-rank">#${rank}</span>
    ${photoImg}
    <span class="tp-name" style="color:${col}">${p.name}</span>
    <span class="tp-pos pos-${p.pos}">${p.posL}</span>
    <span class="tp-team-lbl">${p.teamName}</span>
    <span class="tp-fc">${p.fp90.toFixed(1)} FC/90</span>
    <span class="tp-pct ${tpProbCls(p1)}">${Math.round(p1*100)}%</span>
    <span class="tp-pct ${tpProbCls(p2)}">${Math.round(p2*100)}%</span>
    <span class="tp-pct ${tpProbCls(p3)}">${Math.round(p3*100)}%</span>
  </div>`;
}

function renderTopPicksTab(fx,ht,at){
  const tab=document.getElementById('tab-tp');
  if(!tab)return;
  tab.innerHTML=buildTopPicksTab(fx,ht,at);
}

function buildTopPicksTab(fx,ht,at){
  if(!_saHomePlayers.length && !_saAwayPlayers.length){
    return`<div class="no-data" style="padding:40px 20px">
      <i class="ti ti-star"></i>
      <strong>Waiting for season analysis</strong><br>
      Top Picks are derived from the same club-stat data shown in the Analysis tab. Open the Analysis tab first, or wait for it to finish loading.
    </div>`;
  }

  const lineups = fx.lineups||[];
  const hasLineups = lineups.length>=2;
  let hPool = _saHomePlayers, aPool = _saAwayPlayers, narrowed=false;

  if(hasLineups){
    const hResult = filterToConfirmedStarters(_saHomePlayers, lineups[0]);
    const aResult = filterToConfirmedStarters(_saAwayPlayers, lineups[1]);
    if(hResult && aResult){
      // Top picks uses starters only (bench unlikely to play full 90)
      hPool = hResult.starters;
      aPool = aResult.starters;
      narrowed = true;
    }
  }

  // Tag each player with team name/colour so we can merge into one ranked list
  const pool = [
    ...hPool.map(p=>({...p, teamName:fx.teams.home.name, col:ht.c})),
    ...aPool.map(p=>({...p, teamName:fx.teams.away.name, col:at.c})),
  ];

  const bookingPicks = pool
    .filter(p=>!p.noData && !p.foulsMissing && p.prob!==null)
    .sort((a,b)=>b.prob-a.prob)
    .slice(0,6);

  const foulPicks = pool
    .filter(p=>!p.noData && !p.foulsMissing && p.fp90>0)
    .sort((a,b)=>poissonAtLeast(b.fp90,1)-poissonAtLeast(a.fp90,1))
    .slice(0,8);

  const banner = hasLineups
    ? (narrowed
        ? `<div class="tip-box" style="background:rgba(0,184,118,.06);border-color:rgba(0,184,118,.2)">
            <strong style="color:var(--low)">✓ Confirmed starting XIs</strong> — rankings below are limited to the 22 confirmed starters.
          </div>`
        : `<div class="tip-box" style="background:rgba(232,135,30,.06);border-color:rgba(232,135,30,.2)">
            <strong style="color:var(--med)">⚠ Couldn't match lineup to stats</strong> — showing full squad rankings instead. Some listed players may not start.
          </div>`)
    : `<div class="tip-box" style="background:rgba(212,21,21,.06);border-color:rgba(212,21,21,.2)">
        <strong style="color:var(--high)">⚠ Lineup not confirmed yet</strong> — rankings below cover the full squad. Narrow to confirmed starters once the XI is published (usually 20–40 min before kickoff).
      </div>`;

  const bookingHtml = bookingPicks.length
    ? bookingPicks.map((p,i)=>buildBookingPickRow(p,p.col,i+1)).join('')
    : `<div class="no-data" style="padding:16px"><i class="ti ti-shield-off"></i>No booking-probability data available.</div>`;

  const foulHtml = foulPicks.length
    ? `<div class="tp-foul-hdr">
        <span></span><span></span><span>Player</span><span></span><span>Team</span><span>Rate</span><span>1+</span><span>2+</span><span>3+</span>
      </div>` + foulPicks.map((p,i)=>buildFoulPickRow(p,p.col,i+1)).join('')
    : `<div class="no-data" style="padding:16px"><i class="ti ti-ban"></i>No foul-rate data available for this match's competitions.</div>`;

  return`${banner}
  <h2 class="stitle"><i class="ti ti-shield-check"></i>Most likely to be booked <span class="chip chip-af" style="margin-left:6px">P(yellow card)</span></h2>
  <div class="tp-list" style="margin-bottom:22px">${bookingHtml}</div>

  <h2 class="stitle"><i class="ti ti-flag"></i>Most likely to commit fouls <span class="chip chip-af" style="margin-left:6px">Poisson, λ = FC/90</span></h2>
  <div style="font-size:10px;color:var(--dim);margin-bottom:10px">
    P(1+), P(2+), P(3+) = probability of committing at least that many fouls this match, assuming a full 90 minutes at this season's foul rate.
  </div>
  <div class="tp-list">${foulHtml}</div>`;
}

function buildLUList(lineup,subMap,col){
  const starters=lineup.startXI||[];
  const subs=lineup.substitutes||[];
  const row=(p,isSub)=>{
    const name=p.player?.name||'?';
    const num=p.player?.number||'';
    const pos=p.player?.pos||'';
    const sub=subMap[name];
    const sOff=!isSub&&sub?.out;
    const sOn=isSub&&sub?.in;
    return`<div class="lu-row">
      <span class="lu-num" style="color:${col}">${num}</span>
      <span class="lu-name${(isSub&&!sOn)?' dim':''}">${name}</span>
      ${pos?`<span class="lu-pos pos-${normalizePos(pos)}">${pos}</span>`:''}
      ${sOff?`<span class="lu-sub-txt sub-off-c">↓${sub.time?sub.time+"'":''}${sub.replacedBy?' ('+sub.replacedBy+')':''}</span>`:''}
      ${sOn?`<span class="lu-sub-txt sub-on-c">↑${sub.time?sub.time+"'":''}${sub.replacementOf?' ('+sub.replacementOf+')':''}</span>`:''}
    </div>`;
  };
  let h=starters.map(p=>row(p,false)).join('');
  if(subs.length)h+=`<div class="lu-sec-hd">Substitutes</div>`+subs.map(p=>row(p,true)).join('');
  return h;
}

function buildLineupsTab(fx,ht,at){
  const lineups=fx.lineups||[];
  const events=fx.events||[];
  if(!lineups.length){
    const ns=!isLive(fx.fixture.status.short)&&!isFinal(fx.fixture.status.short);
    return`<div class="no-data"><i class="ti ti-layout-list"></i><strong>Lineup not available</strong><br>
    ${ns?'Starting XIs are published 20–40 minutes before kickoff for covered competitions.':'No lineup data recorded for this match.'}</div>`;
  }
  const hL=lineups[0],aL=lineups[1]||lineups[0];
  // Build sub map from events (legacy — still used by buildLUList)
  const sm={};
  for(const ev of events){
    if(ev.type!=='subst')continue;
    const off=ev.player?.name,on=ev.assist?.name;
    const t=ev.time.extra?`${ev.time.elapsed}+${ev.time.extra}`:String(ev.time.elapsed);
    if(off)sm[off]={out:true,time:t,replacedBy:on,tid:ev.team.id};
    if(on)sm[on]={in:true,time:t,replacementOf:off,tid:ev.team.id};
  }
  // Full events lookup (cards + subs) for pitch overlay
  const evLk = eventsLookup(events);
  return`
    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-bottom:14px;padding:11px 14px;background:var(--card2);border:1px solid var(--border);border-radius:10px;">
      <div>
        <div style="font-size:13px;font-weight:600;color:${ht.c}">${fx.teams.home.name}</div>
        ${hL.coach?.name?`<div style="font-size:10px;color:var(--dim);margin-top:2px"><i class="ti ti-user" style="font-size:9px"></i> ${hL.coach.name}</div>`:''}
      </div>
      <div style="text-align:center;font-size:18px;font-weight:800;font-family:var(--mono);color:var(--gold)">
        ${hL.formation||'?'} <span style="color:var(--dim);font-size:12px;font-weight:600">vs</span> ${aL.formation||'?'}
      </div>
      <div style="text-align:right">
        <div style="font-size:13px;font-weight:600;color:${at.c}">${fx.teams.away.name}</div>
        ${aL.coach?.name?`<div style="font-size:10px;color:var(--dim);margin-top:2px">${aL.coach.name} <i class="ti ti-user" style="font-size:9px"></i></div>`:''}
      </div>
    </div>
    <div class="pitch-stat-toggle">
      <span class="pitch-stat-lbl">Show on pitch:</span>
      <button class="pitch-stat-btn${_pitchStatMode==='cards'?' on':''}" onclick="setPitchStat('cards',this)">Card %</button>
      <button class="pitch-stat-btn${_pitchStatMode==='fouls'?' on':''}" onclick="setPitchStat('fouls',this)">Fouls/90</button>
      <button class="pitch-stat-btn${_pitchStatMode==='tackles'?' on':''}" onclick="setPitchStat('tackles',this)">Tackles/90</button>
      ${(!_saHomePlayers.length&&!_saAwayPlayers.length)?'<span style="font-size:9px;color:var(--dim);margin-left:8px">Loading from Analysis tab…</span>':''}
    </div>
    <div class="pitch-grid">
      <div class="pitch-box">
        <div class="pitch-box-lbl"><span style="color:${ht.c}">${fx.teams.home.name}</span><span style="color:var(--gold);font-weight:800;font-family:var(--mono)">${hL.formation||''}</span></div>
        ${buildPitch(hL,sm,ht.c,statsLookup(_saHomePlayers),photoLookup(_saHomePlayers),evLk)}
      </div>
      <div class="pitch-box">
        <div class="pitch-box-lbl"><span style="color:${at.c}">${fx.teams.away.name}</span><span style="color:var(--gold);font-weight:800;font-family:var(--mono)">${aL.formation||''}</span></div>
        ${buildPitch(aL,sm,at.c,statsLookup(_saAwayPlayers),photoLookup(_saAwayPlayers),evLk)}
      </div>
    </div>
    <div class="lu-grid">
      <div>
        <div class="lu-thd" style="color:${ht.c}">${fx.teams.home.name}</div>
        ${buildLUList(hL,sm,ht.c)}
      </div>
      <div>
        <div class="lu-thd" style="color:${at.c}">${fx.teams.away.name}</div>
        ${buildLUList(aL,sm,at.c)}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 10 — LIVE STATS TAB (per-player match stats)
// ═══════════════════════════════════════════════════════════════
function buildLiveStatsTab(fx,ht,at){
  const players=fx.players||[];
  const hId=fx.teams.home.id;
  const live=isLive(fx.fixture.status.short);
  if(!players.length){
    return`<div class="no-data"><i class="ti ti-activity"></i><strong>Player match stats ${live?'loading…':'not available'}</strong><br>
    Per-player statistics are recorded for supported competitions once the match begins.<br>
    <span style="font-size:10px">Live data updates every 60 seconds for covered competitions.</span></div>`;
  }
  const hPs=players.find(t=>t.team.id===hId)?.players||[];
  const aPs=players.find(t=>t.team.id!==hId)?.players||[];

  const teamRows=(teamPs,teamName,col)=>{
    if(!teamPs.length)return`<tr><td class="ls-tbl team-sep" colspan="9" style="color:${col}">${teamName} — No player data</td></tr>`;
    const sorted=[...teamPs].sort((a,b)=>(b.statistics?.[0]?.fouls?.committed||0)-(a.statistics?.[0]?.fouls?.committed||0));
    let h=`<tr><td class="ls-tbl team-sep" colspan="9" style="color:${col}">${teamName}</td></tr>`;
    for(const p of sorted){
      const st=p.statistics?.[0]||{};
      const mins=st.games?.minutes;
      const fc=st.fouls?.committed??'-';
      const fd=st.fouls?.drawn??'-';
      const tk=st.tackles?.total??'-';
      const dw=st.duels?.won;
      const dt=st.duels?.total;
      const duelStr=dw!==undefined&&dt!==undefined?`${dw}/${dt}`:'-';
      const shots=`${st.shots?.on??'-'}/${st.shots?.total??'-'}`;
      const rat=parseFloat(st.games?.rating)||0;
      const ratCls=rat>=7.5?'rat-hi':rat>=6.5?'rat-md':rat>0?'rat-lo':'';
      const fcNum=st.fouls?.committed||0;
      const fcCls=fcNum>=4?'fc-hi':fcNum>=2?'fc-md':'';
      h+=`<tr>
        <td>${p.player.name}</td>
        <td>${mins!==undefined?mins+"'":'?'}</td>
        <td class="${fcCls}">${fc}</td>
        <td>${fd}</td>
        <td>${tk}</td>
        <td>${duelStr}</td>
        <td>${shots}</td>
        <td>${rat?`<span class="rat ${ratCls}">${rat.toFixed(1)}</span>`:'-'}</td>
        <td>${st.cards?.yellow?'🟨':''}${st.cards?.red?'🟥':''}</td>
      </tr>`;
    }
    return h;
  };

  return`<div>
    <h2 class="stitle"><i class="ti ti-activity"></i>Player match statistics <span class="chip chip-live" style="margin-left:6px">${live?'LIVE':'MATCH DATA'}</span></h2>
    <div style="font-size:10px;color:var(--dim);margin-bottom:12px">Sorted by fouls committed · 🔴 4+ fouls · 🟡 2-3 fouls · FC = committed · FD = drawn · data from single API call</div>
    <div class="ls-wrap">
      <table class="ls-tbl">
        <thead><tr>
          <th>Player</th><th>Mins</th>
          <th title="Fouls committed" style="color:var(--high)">FC</th>
          <th title="Fouls drawn">FD</th>
          <th>Tackles</th><th>Duels</th>
          <th>Shots</th><th>Rating</th><th>Cards</th>
        </tr></thead>
        <tbody>
          ${teamRows(hPs,fx.teams.home.name,ht.c)}
          ${teamRows(aPs,fx.teams.away.name,at.c)}
        </tbody>
      </table>
    </div>
    <div style="font-size:9px;color:var(--dim);margin-top:10px">FC = Fouls committed · FD = Fouls drawn · Duels = won/total · Shots = on target/total</div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 11 — SEASON ANALYSIS TAB (card probability)
// ═══════════════════════════════════════════════════════════════
function processPlayers(response){
  return response.map(r=>{
    const p=r.player;
    const stats=r.statistics||[];

    // Apply same priority as extractDomesticStats:
    // main leagues first (even with few apps), then 5+ app fallback, cups excluded
    const mainRows=stats
      .filter(s=>MAIN_LEAGUE_IDS.has(s.league?.id)&&(s.games?.appearences||0)>0)
      .sort((a,b)=>(b.games?.appearences||0)-(a.games?.appearences||0));
    const fallbackRows=mainRows.length===0
      ? stats.filter(s=>!INTL_LEAGUES.has(s.league?.id)&&(s.games?.appearences||0)>=1)
             .sort((a,b)=>(b.games?.appearences||0)-(a.games?.appearences||0))
      : [];
    const st=mainRows[0]||fallbackRows[0];
    if(!st) return null; // only cup data or nothing useful

    const mins=Math.max(st.games?.minutes||0,1);
    const apps=st.games?.appearences||1;
    const fc=st.fouls?.committed||0;
    const fd=st.fouls?.drawn||0;
    const tk=st.tackles?.total||0;
    const yc=st.cards?.yellow||0;
    const drb=st.dribbles?.attempts||0;
    const duelsW=st.duels?.won||0, duelsT=st.duels?.total||0;
    const pos=normalizePos(st.games?.position);
    const fp90=fc/mins*90;
    // Detect likely missing foul data: outfield player with ≥4 apps and 0 fouls
    // API-Football doesn't track fouls for all competitions (friendlies, some intls)
    const foulsMissing=(pos!=='G')&&apps>=4&&fc===0&&tk===0;
    return{
      id:p.id, name:p.name, pos, posL:posLabel(pos), photo:p.photo||null,
      fp90, tp90:tk/mins*90, yc, apps, mins,
      totalFouls:fc, totalTackles:tk,
      fd90:fd/mins*90, drb90:drb/mins*90, duelsW90:duelsW/mins*90, duelsT90:duelsT/mins*90,
      srcTeam:st.team?.name||null,
      srcLeague:st.league?.name||null,
      srcSeason:st.league?.season||null,
      lowConf:apps<8,
      foulsMissing,
      prob:foulsMissing?null:cardProb(fp90,pos,yc,apps),
    };
  }).filter(p=>p&&p.apps>0&&p.mins>0).sort((a,b)=>(b.prob??-1)-(a.prob??-1));
}

function posLabel(pos){
  const p=(pos||'').toUpperCase();
  if(p==='G')return'GK';if(p==='D')return'DEF';if(p==='M')return'MID';if(p==='F')return'FWD';
  return pos||'?';
}

// Sum of starting-XI card probabilities — "expected yellows" for a team.
// Shared by the season-analysis card-expectation banner and the
// calibration self-check (updateCalibrationCheck).
function calcExpectedCards(players){
  // Excludes injured/suspended players — see _currentInjuries (getInjuries())
  // — an unavailable player contributes zero probability of a card because
  // they won't be on the pitch, not because their model output is null.
  const s=(players||[]).filter(p=>p.xistatus==='starter'&&p.prob!==null&&!p.noData&&!_currentInjuries?.has(p.id));
  return s.length?s.reduce((acc,p)=>acc+p.prob,0):null;
}

function cardProb(fp90,pos,yc,apps,recentFactor=1){
  const pf={'G':0.2,'D':1.4,'M':1.0,'F':0.65}[pos]||1.0;
  // _currentRefFactor (see getRefereeFactor()) and recentFactor (see
  // recentFormFactor(), SECTION 4d) both only scale the foul-based half of
  // λ, not the historical-rate half — neither the referee nor a recent hot
  // streak rewrites a player's career card history, and as a player's own
  // sample size grows (w→1) their history correctly dominates over either
  // adjustment anyway.
  const foulBased=fp90*0.12*pf*_currentRefFactor*recentFactor;
  const hist=apps>0?yc/apps:0;
  const w=Math.min(apps/20,1);
  const lambda=foulBased*(1-w)+hist*w;
  return Math.min(1-Math.exp(-lambda),0.95);
}

function buildSeasonTab(hPs,aPs,fx,ht,at,meta={}){
  const {isIntl,src,cSeason,blend,seasonChain} = meta;
  const seasonLbl = s => `${s}/${String(s+1).slice(2)}`;

  let banner='';
  if(isIntl && src==='club'){
    banner=`<div class="tip-box" style="background:rgba(0,184,118,.06);border-color:rgba(0,184,118,.2)">
      <strong style="color:var(--low)">✓ Club stats loaded</strong> — each confirmed starter's domestic league stats from ${cSeason}/${String(cSeason+1).slice(2)}, not their international appearances. Click any player card to see the breakdown.
    </div>`;
  } else if(isIntl && src==='squad'){
    banner=`<div class="tip-box" style="background:rgba(0,184,118,.06);border-color:rgba(0,184,118,.2)">
      <strong style="color:var(--low)">✓ Club stats loaded</strong> — lineup not confirmed yet, so this shows the full ${hPs.length+aPs.length>30?'squad':'confirmed squad'} with domestic league stats from ${cSeason}/${String(cSeason+1).slice(2)}. Once the starting XI is published, open this match again to narrow to the 22 starters.
    </div>`;
  } else if(isIntl && src==='intl'){
    banner=`<div class="tip-box" style="background:rgba(212,21,21,.06);border-color:rgba(212,21,21,.2)">
      <strong style="color:var(--high)">⚠ Squad not submitted yet</strong> — showing national team competition stats (small sample). Once the squad is confirmed, open this match again for full club stats.
    </div>`;
  } else if(!isIntl && src==='club' && blend && seasonChain?.length===2){
    banner=`<div class="tip-box" style="background:rgba(0,71,181,.08);border-color:var(--border2)">
      <strong style="color:var(--cobalt-text)">ℹ Both seasons combined</strong> — stats below blend ${seasonLbl(seasonChain[0])} and ${seasonLbl(seasonChain[1])} (minutes-weighted) for a bigger, steadier sample. Switch to a single season in the sidebar for that season's numbers only.
    </div>`;
  } else if(!isIntl && src==='club' && !blend && seasonChain?.length===1){
    const isComplete = seasonChain[0]<lastClubSeason();
    banner=`<div class="tip-box" style="background:rgba(0,71,181,.05);border-color:var(--border)">
      <strong style="color:var(--muted)">${seasonLbl(seasonChain[0])} only</strong> — showing exactly this season's domestic stats, no fallback to another season. A player with no data here ${isComplete?'simply had none in a domestic league that season':"just hasn't played enough domestic minutes yet this season"}; switch to "Both" in the sidebar to blend in the other season instead.
    </div>`;
  }

  // Referee-tendency disclosure — only shown when an adjustment actually
  // applied (enough historical matches by this referee were found). See
  // getRefereeFactor(): the numbers here are real per-match card counts,
  // not an estimate, so they're worth surfacing rather than hiding inside
  // the per-player formula breakdown only.
  let refBanner='';
  if(_currentRefMeta && _currentRefMeta.sample>=REF_MIN_SAMPLE && _currentRefMeta.avgCards!==null){
    const pctShift = Math.round((_currentRefMeta.factor-1)*100);
    const dir = pctShift>0 ? 'more' : 'fewer';
    refBanner = pctShift===0 ? '' : `<div class="tip-box" style="background:rgba(240,179,35,.06);border-color:rgba(240,179,35,.2)">
      <strong style="color:var(--gold)">🟨 Referee factor applied</strong> — ${_currentRefMeta.refereeName} has averaged ${_currentRefMeta.avgCards.toFixed(1)} cards/match in this league this season vs a ${_currentRefMeta.leagueAvgCards.toFixed(1)} baseline (${_currentRefMeta.sample} of their matches analysed), so the foul-based half of each player's probability below is adjusted ${Math.abs(pctShift)}% ${dir} likely than usual.
    </div>`;
  }

  const teamSec=(players, col, teamName)=>{
    if(!players.length)return`<div class="no-data" style="padding:14px">
      <i class="ti ti-user-off" style="font-size:20px;display:block;margin-bottom:6px"></i>No stats available.
    </div>`;
    const starters = players.filter(p=>p.xistatus==='starter');
    const bench    = players.filter(p=>p.xistatus==='bench');
    const rest     = players.filter(p=>!p.xistatus); // squad-only path, no tag
    if(starters.length || bench.length){
      return`
        <div class="sa-xi-hd"><i class="ti ti-circle-filled" style="color:var(--low);font-size:8px"></i> Starting XI</div>
        ${starters.map(p=>buildSaCard(p,isIntl,src)).join('')}
        ${bench.length?`<div class="sa-xi-hd sa-xi-bench"><i class="ti ti-arrows-exchange" style="color:var(--dim);font-size:9px"></i> Substitutes</div>
        ${bench.map(p=>buildSaCard(p,isIntl,src)).join('')}`:''}`;
    }
    return rest.map(p=>buildSaCard(p,isIntl,src)).join('');
  };

  // ── Card expectation summary ─────────────────────────────────
  const hExp=calcExpectedCards(hPs), aExp=calcExpectedCards(aPs);
  const cardBanner=(hExp!==null||aExp!==null)?`
  <div class="csb">
    <div class="csb-team">
      <div class="csb-nm" style="color:${ht.c}">${fx.teams.home.name}</div>
      <div class="csb-num" style="color:${ht.c}">${hExp!==null?hExp.toFixed(1):'—'}</div>
      <div class="csb-lbl">expected yellows</div>
    </div>
    <div class="csb-mid"><div class="csb-mid-ico">🟨</div><div class="csb-mid-txt">team total</div></div>
    <div class="csb-team">
      <div class="csb-nm" style="color:${at.c}">${fx.teams.away.name}</div>
      <div class="csb-num" style="color:${at.c}">${aExp!==null?aExp.toFixed(1):'—'}</div>
      <div class="csb-lbl">expected yellows</div>
    </div>
  </div>
  <div id="calib-check"></div>`:'';

  // ── Top threat per team ──────────────────────────────────────
  const topThreat=(players)=>players.filter(p=>p.xistatus==='starter'&&p.prob!==null&&!p.noData&&!_currentInjuries?.has(p.id)).sort((a,b)=>b.prob-a.prob)[0]||null;
  const hTop=topThreat(hPs), aTop=topThreat(aPs);
  function hex2rgba(hex,a){const r=hex.replace('#','').match(/.{2}/g)||['0','47','b5'];return`rgba(${r.map(x=>parseInt(x,16)).join(',')},${a})`;}
  const threatBanner=(hTop||aTop)?`
  <div class="top-threat">
    <div class="tt-card" style="border-color:${hex2rgba(ht.c,.3)};border-top:2px solid ${ht.c}">
      <div class="tt-label" style="color:${ht.c}">⚠ Top risk · ${fx.teams.home.name.split(' ').pop()}</div>
      ${hTop?`<div class="tt-name">${hTop.name}</div><div class="tt-pct ${probColor(Math.round(hTop.prob*100))}">${Math.round(hTop.prob*100)}%</div><div class="tt-sub">yellow card probability</div>`:'<div style="color:var(--dim);font-size:11px;padding:8px 0">No data</div>'}
    </div>
    <div class="tt-card" style="border-color:${hex2rgba(at.c,.3)};border-top:2px solid ${at.c}">
      <div class="tt-label" style="color:${at.c}">⚠ Top risk · ${fx.teams.away.name.split(' ').pop()}</div>
      ${aTop?`<div class="tt-name">${aTop.name}</div><div class="tt-pct ${probColor(Math.round(aTop.prob*100))}">${Math.round(aTop.prob*100)}%</div><div class="tt-sub">yellow card probability</div>`:'<div style="color:var(--dim);font-size:11px;padding:8px 0">No data</div>'}
    </div>
  </div>`:'';

  return`${banner}${refBanner}${cardBanner}${threatBanner}
  <h2 class="stitle"><i class="ti ti-target"></i>Card probability — season analysis
    <span class="chip chip-af" style="margin-left:6px">Poisson model</span>
    ${isIntl&&(src==='club'||src==='squad')?`<span class="chip" style="margin-left:4px;background:rgba(0,184,118,.12);color:var(--low);border:1px solid rgba(0,184,118,.25)">Club stats</span>`:''}
    ${isIntl&&src==='squad'?`<span class="chip" style="margin-left:4px;background:rgba(240,179,35,.1);color:var(--gold);border:1px solid rgba(240,179,35,.25)">Full squad</span>`:''}
  </h2>
  <div style="font-size:10px;color:var(--dim);margin-bottom:14px">
    P(yellow card this match) · click a player to see the full breakdown and source
  </div>
  <div class="sa-grid">
    <div><div class="sa-thd" style="color:${ht.c}">${fx.teams.home.name}</div>${teamSec(hPs,ht.c,fx.teams.home.name)}</div>
    <div><div class="sa-thd" style="color:${at.c}">${fx.teams.away.name}</div>${teamSec(aPs,at.c,fx.teams.away.name)}</div>
  </div>`;
}

function buildSaCard(p,isIntl,src){
  const inj = _currentInjuries?.get(p.id) || null; // {type,reason} if this player is out for this fixture
  const probNull = p.prob===null || p.foulsMissing || p.noData || !!inj;
  const pct = probNull ? null : Math.round(p.prob*100);
  const cls = pct!==null ? probColor(pct) : '';
  const barCol = pct!==null ? probBarColor(pct) : 'var(--dim)';
  const isDanger = pct!==null && pct>=25;

  // Player photo or initials placeholder
  const initials=(p.name||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  const photoEl=p.photo
    ?`<img src="${p.photo}" alt="${p.name}" class="sa-avatar" loading="lazy" onerror="this.outerHTML='<div class=\\'sa-avatar-ph\\'>${initials}</div>'">`
    :`<div class="sa-avatar-ph">${initials}</div>`;
  // Conic-gradient progress ring wrapped around the avatar — same 0-50%→
  // Deliberately the RAW probability, not the ×2-amplified scale the bar
  // below uses — a ring reads as "this much of the full circle" far more
  // literally than a bar does, so amplifying it would make a genuinely
  // low-risk player's ring look alarmingly over half full. Most players
  // sit well under 50% either way, which is the honest picture: a mostly-
  // empty ring for the common case, a visibly fuller one standing out for
  // the rare high-risk player. Purely decorative when there's no real
  // number (inj/OUT, no-data): renders as an empty dim ring rather than
  // being hidden, so the layout doesn't shift between card states.
  const ringPct = pct!==null ? Math.min(pct,100) : 0;
  const ringCol = pct!==null ? barCol : 'var(--dim)';
  const avatarRing = `<div class="sa-avatar-ring" style="--pct:${ringPct};--ring-col:${ringCol}">${photoEl}</div>`;

  // Badges
  const confWarn = (p.lowConf && !p.noData) ? `<span style="font-size:9px;color:var(--med);margin-left:5px">⚠ ${p.apps} apps</span>` : '';
  const missingWarn = p.foulsMissing ? `<span style="font-size:9px;color:var(--high);margin-left:5px">⚠ No foul data</span>` : '';
  const noDataWarn = p.noData ? `<span style="font-size:9px;color:var(--dim);margin-left:5px">⚠ No data found</span>` : '';
  const injuryWarn = inj ? `<span style="font-size:9px;color:var(--high);font-weight:700;margin-left:5px">🚑 ${inj.reason||inj.type||'Unavailable'}</span>` : '';

  // srcSeason is either a real season year, or the string 'both' for a
  // blended player (see blendPlayerStats()) — those carry the two seasons
  // that went into the blend in srcSeasons instead.
  const seasonTag = p.srcSeason==='both'
    ? (p.srcSeasons?.length ? p.srcSeasons.map(s=>`${s}/${String(s+1).slice(2)}`).join('+')+' combined' : 'combined seasons')
    : (p.srcSeason ? `${p.srcSeason}/${String(p.srcSeason+1).slice(2)}` : '');
  const src_txt = p.noData
    ? 'No club stats available for this season'
    : (p.srcTeam || p.srcLeague
      ? `${p.srcTeam||''}${p.srcTeam&&p.srcLeague?' · ':''}${p.srcLeague||''}${seasonTag?' ('+seasonTag+')':''}`
      : (isIntl&&src==='intl'?'National team competition':'Club data'));

  // Formula breakdown for expanded view
  const posFactor = {'G':0.2,'D':1.4,'M':1.0,'F':0.65}[p.pos]||1.0;
  const refFactor = _currentRefFactor;
  const refApplied = _currentRefMeta && _currentRefMeta.sample>=REF_MIN_SAMPLE && _currentRefMeta.avgCards!==null && refFactor!==1;
  const recentFactor = p.recentFormFactor || 1; // see applyRecentForm()/recentFormFactor(), SECTION 4d
  const recentApplied = recentFactor!==1;
  const foulLambda = (p.fp90*0.12*posFactor*refFactor*recentFactor).toFixed(3);
  const histRate = p.apps>0 ? (p.yc/p.apps).toFixed(3) : '0.000';
  const weight = Math.min(p.apps/20,1).toFixed(2);
  const blendedLambda = p.prob!==null ? (-Math.log(1-Math.min(p.prob,0.9499))).toFixed(3) : '—';

  const expandHtml = inj
    ? `<div class="sa-expand">
        <div class="sa-ex-warn">🚑 Ruled out for this match — ${inj.reason||inj.type||'unavailable'}. No card probability is shown for a player who isn't expected to play.</div>
      </div>`
    : p.noData
    ? `<div class="sa-expand">
        <div class="sa-ex-warn">No club statistics could be found for this player in the last two seasons. They may play in a competition that isn't covered, or have moved clubs recently.</div>
      </div>`
    : `<div class="sa-expand">
    <div class="sa-ex-row"><span style="color:var(--dim);min-width:90px">Source</span><b>${src_txt||'—'}</b></div>
    <div class="sa-ex-row"><span style="color:var(--dim);min-width:90px">Apps · mins</span><b>${p.apps} apps · ${p.mins} mins played</b></div>
    <div class="sa-ex-row"><span style="color:var(--dim);min-width:90px">Fouls committed</span><b>${p.totalFouls||0} total · ${p.fp90.toFixed(2)}/90</b></div>
    <div class="sa-ex-row"><span style="color:var(--dim);min-width:90px">Tackles</span><b>${p.totalTackles||0} total · ${p.tp90.toFixed(2)}/90</b></div>
    <div class="sa-ex-row"><span style="color:var(--dim);min-width:90px">Yellow cards</span><b>${p.yc} in ${p.apps} apps (${(p.yc/Math.max(p.apps,1)*100).toFixed(0)}%)</b></div>
    ${p.foulsMissing?'':
    `<div class="sa-ex-formula">
      <div>FC/90 <span class="val">${p.fp90.toFixed(2)}</span> × pos.factor <span class="val">${posFactor}</span> (${p.posL}) × 0.12${refApplied?` × ref.factor <span class="val">${refFactor.toFixed(2)}</span>`:''}${recentApplied?` × recent.factor <span class="val">${recentFactor.toFixed(2)}</span>`:''} = λ<sub>foul</sub> <span class="val">${foulLambda}</span></div>
      <div>YC rate <span class="val">${histRate}</span> /game · blend weight <span class="val">${weight}</span> (${p.apps} apps / 20)</div>
      <div>Blended λ <span class="${cls}">${blendedLambda}</span> → P(YC) = 1 − e<sup>−λ</sup> = <span class="${cls}">${pct}%</span></div>
      ${refApplied?`<div style="color:var(--dim);font-size:10px">Ref factor ${refFactor.toFixed(2)}× from ${_currentRefMeta.refereeName}'s ${_currentRefMeta.sample}-match card rate this season</div>`:''}
      ${recentApplied?`<div style="color:var(--dim);font-size:10px">Recent-form factor ${recentFactor.toFixed(2)}× — fouling ${recentFactor>1?'more':'less'} than usual over their last ${RECENT_FORM_MATCHES} matches</div>`:''}
    </div>`}
    ${p.foulsMissing?`<div class="sa-ex-warn">Foul data unavailable for this competition — not all leagues and tournaments are tracked. Card probability cannot be calculated.</div>`:''}
  </div>`;

  return`<div class="sa-card${p.lowConf?' low-conf':''}${p.noData?' no-data-card':''}${inj?' injury-card':''}${p.xistatus==='bench'?' bench-card':''}${isDanger?' danger-card':''}" onclick="_toggleSaCard(this)" role="button" tabindex="0" aria-expanded="false" onkeydown="_kbActivate(event)">
    <div class="sa-top">
      ${avatarRing}
      <div style="min-width:0;flex:1;display:flex;align-items:center;flex-wrap:wrap;gap:4px">
        ${p.number?`<span class="sa-kit-num">${p.number}</span>`:''}
        <span class="sa-nm" style="${inj?'opacity:.6':''}">${p.name}</span>
        <span class="sa-pos-badge pos-${p.pos}">${p.posL}</span>
        ${injuryWarn}${confWarn}${missingWarn}${noDataWarn}
      </div>
      <span class="sa-pct ${inj?'':cls}" style="flex-shrink:0;${inj?'color:var(--high);font-size:10px;font-weight:800;letter-spacing:.02em':''}">${inj?'OUT':(pct!==null?pct+'%':'—')}</span>
    </div>
    <div class="sa-bar"><div class="sa-bar-fill" style="--bw:${pct!==null?Math.min(pct/50*100,100):0}%;width:var(--bw);background:${barCol};${p.lowConf||probNull?'opacity:.5':''}"></div></div>
    <div class="sa-meta">
      <span>FC/90 <b>${p.fp90.toFixed(1)}</b></span>
      <span>Tkl/90 <b>${p.tp90.toFixed(1)}</b></span>
      <span>YC <b>${p.yc}/${p.apps}</b></span>
      <span style="color:var(--dim);font-size:9px;margin-left:auto">${src_txt}</span>
    </div>
    ${expandHtml}
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 12 — ODDS TAB
// ═══════════════════════════════════════════════════════════════
function buildOddsTab(predData,oddsData,fx,ht,at){
  const pred=predData?.response?.[0]?.predictions;
  const bets=oddsData?.response?.[0]?.bookmakers?.[0]?.bets||[];

  if(!pred&&!bets.length){
    return`<div class="no-data"><i class="ti ti-trending-up"></i><strong>No predictions available</strong><br>
    Win probability models and bookmaker odds are typically published 48–72 hours before kickoff, and may not be available for all competitions.</div>`;
  }

  let h=`<h2 class="stitle"><i class="ti ti-trending-up"></i>Predictions</h2>`;
  // Declared at function scope (not inside `if(pred)`) so the value-vs-odds
  // block further down — inside a separate `if(bets.length)` block — can
  // still read them.
  let hp=null, dp=null, ap=null;

  if(pred){
    const wp=pred.percent||{};
    hp=parseInt(wp.home)||33; dp=parseInt(wp.draw)||34; ap=100-hp-dp;
    if(pred.winner?.name){
      h+=`<div class="pred-winner">
        <div class="pw-lbl">Predicted winner</div>
        <div class="pw-val">${pred.winner.name}</div>
        ${pred.advice?`<div style="font-size:11px;color:var(--muted);margin-top:5px">${pred.advice}</div>`:''}
      </div>`;
    }
    h+=`<div class="pred-wrap">
      <div class="pred-teams">
        <span style="color:${ht.c}">${fx.teams.home.name}</span>
        <span style="color:var(--dim);font-size:11px">Draw</span>
        <span style="color:${at.c}">${fx.teams.away.name}</span>
      </div>
      <div class="pred-bar">
        <div style="width:${hp}%;background:${ht.c};height:100%;border-radius:4px 0 0 4px"></div>
        <div style="width:${dp}%;background:rgba(255,255,255,.15);height:100%"></div>
        <div style="width:${ap}%;background:${at.c};height:100%;border-radius:0 4px 4px 0"></div>
      </div>
      <div class="pred-pcts">
        <span style="color:${ht.c}">${hp}%</span>
        <span style="color:var(--muted)">${dp}%</span>
        <span style="color:${at.c}">${ap}%</span>
      </div>
    </div>`;

    if(pred.goals?.home!==undefined){
      h+=`<div class="goals-grid">
        <div class="goals-card">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin-bottom:4px">Home goals</div>
          <div style="font-size:24px;font-weight:700;font-family:var(--mono);color:${ht.c}">${pred.goals.home??'-'}</div>
        </div>
        <div class="goals-card">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin-bottom:4px">Away goals</div>
          <div style="font-size:24px;font-weight:700;font-family:var(--mono);color:${at.c}">${pred.goals.away??'-'}</div>
        </div>
      </div>`;
    }
  }

  if(bets.length){
    const getOdds=name=>(bets.find(b=>b.name===name)?.values||[]);
    const mw=getOdds('Match Winner');
    if(mw.length){
      const hO=mw.find(v=>v.value==='Home'),dO=mw.find(v=>v.value==='Draw'),aO=mw.find(v=>v.value==='Away');
      // Value indicator: compares the model's own win-probability % (pred,
      // already fetched above for the same fixture) against what each
      // bookmaker price implies (100/odds). A gap means the model and the
      // market disagree — worth a second look, not a guaranteed edge, so
      // it's labelled and thresholded conservatively (±5pp) rather than
      // flagging every small rounding difference.
      const VALUE_THRESHOLD = 5;
      const valueTag = (modelPct, odd) => {
        if(modelPct==null || !odd) return '';
        const implied = 100/parseFloat(odd);
        const edge = modelPct - implied;
        if(edge >= VALUE_THRESHOLD) return `<div class="odds-value-tag odds-value-pos" title="Model gives this ${modelPct}% vs the bookmaker's implied ${implied.toFixed(0)}% — the model rates it more likely than the price suggests">▲ +${edge.toFixed(0)}pp</div>`;
        if(edge <= -VALUE_THRESHOLD) return `<div class="odds-value-tag odds-value-neg" title="Model gives this ${modelPct}% vs the bookmaker's implied ${implied.toFixed(0)}% — the market rates it more likely than the model does">▼ ${edge.toFixed(0)}pp</div>`;
        return '';
      };
      h+=`<div class="odds-sec-ttl">1X2 odds — Bwin${pred?' <span style="font-size:9px;color:var(--dim);font-weight:400;text-transform:none;letter-spacing:0">vs model win prediction</span>':''}</div>
      <div class="odds-grid">
        ${[{o:hO,l:fx.teams.home.name,col:ht.c,a:ht.a,m:pred?hp:null},{o:dO,l:'Draw',col:'var(--muted)',a:'X',m:pred?dp:null},{o:aO,l:fx.teams.away.name,col:at.c,a:at.a,m:pred?ap:null}].map(x=>`
        <div class="odds-card">
          <div class="odds-lbl" style="color:${x.col}">${x.a}</div>
          <div class="odds-val">${x.o?.odd||'–'}</div>
          ${x.o?.odd?`<div class="odds-imp">${(100/parseFloat(x.o.odd)).toFixed(0)}% implied</div>`:''}
          ${valueTag(x.m, x.o?.odd)}
        </div>`).join('')}
      </div>
      ${pred?`<div style="font-size:9px;color:var(--dim);margin:-6px 0 13px;line-height:1.5">▲ model rates this outcome more likely than the price implies (potential value) · ▼ market rates it more likely than the model does. Not betting advice — the model doesn't see everything a price does (team news, weather, market money).</div>`:''}`;
    }
    const btts=getOdds('Both Teams Score');
    if(btts.length){
      const y=btts.find(v=>v.value==='Yes'),n=btts.find(v=>v.value==='No');
      h+=`<div class="odds-sec-ttl">Both teams to score</div>
      <div class="odds-grid">
        <div class="odds-card"><div class="odds-lbl">Yes</div><div class="odds-val">${y?.odd||'–'}</div></div>
        <div class="odds-card"><div class="odds-lbl">No</div><div class="odds-val">${n?.odd||'–'}</div></div>
        <div class="odds-card" style="opacity:.4"><div class="odds-lbl">&nbsp;</div><div class="odds-val">&nbsp;</div></div>
      </div>`;
    }
    const ou=getOdds('Goals Over/Under');
    if(ou.length){
      h+=`<div class="odds-sec-ttl">Goals over/under</div>
      <div class="odds-grid">${ou.map(v=>`<div class="odds-card"><div class="odds-lbl">${v.value}</div><div class="odds-val">${v.odd}</div></div>`).join('')}</div>`;
    }
  }

  return h||'<div class="no-data">No data available.</div>';
}

// ═══════════════════════════════════════════════════════════════
// SECTION 13 — NAVIGATION
// ═══════════════════════════════════════════════════════════════
function switchTab(id,btn){
  document.querySelectorAll('.tab-btn').forEach(b=>{b.classList.remove('on');b.setAttribute('aria-selected','false');});
  document.querySelectorAll('.tab-pnl').forEach(p=>p.classList.remove('on'));
  if(btn){btn.classList.add('on');btn.setAttribute('aria-selected','true');}
  const pnl=document.getElementById('tab-'+id);
  if(pnl)pnl.classList.add('on');
}

function changeDay(delta){
  _dayOffset+=delta;
  if(_activeId){
    _activeId=null;if(_refreshTmr){clearInterval(_refreshTmr);_refreshTmr=null;}
    document.getElementById('landing').style.display='flex';
    document.getElementById('mv').style.display='none';
  }
  if(_leaguesOpen){
    // Standings aren't day-specific — day nav belongs to the fixture list,
    // so hop back to it rather than leaving Leagues open on a "Prev/Next".
    _leaguesOpen=false;
    document.getElementById('landing').style.display='flex';
    const lgEl=document.getElementById('lg'); if(lgEl)lgEl.style.display='none';
  }
  if(_activeClubId || _clubSearchOpen){
    // Same reasoning — a club page/search isn't day-specific either.
    _activeClubId=null; _clubSearchOpen=false;
    document.getElementById('landing').style.display='flex';
    const clubEl=document.getElementById('club'); if(clubEl)clubEl.style.display='none';
    const csEl=document.getElementById('clubsearch'); if(csEl)csEl.style.display='none';
  }
  syncBottomNav('home'); // changeDay() always lands back on the fixture list
  loadFixtures();
}

// ─── Mobile sidebar drawer ─────────────────────────────────
function openSidebar(){
  document.getElementById('sb').classList.add('sb-open');
  document.getElementById('sb-overlay').classList.add('visible');
  document.body.style.overflow='hidden';
}
function closeSidebar(){
  document.getElementById('sb').classList.remove('sb-open');
  document.getElementById('sb-overlay').classList.remove('visible');
  document.body.style.overflow='';
}

// Mobile bottom nav (2026-08-25 design refresh) — a persistent, always-on
// bar for the top-level destinations, so switching between Fixtures and
// Leagues on a phone is one tap instead of hamburger → drawer → tap →
// drawer-close. Keeps its active pip in sync with whichever view is
// showing; `which` is null while a match is open, since that's a drill-in,
// not one of the bar's own destinations. Every call is null-safe — an
// older cached copy of the HTML without the bar just no-ops here.
function syncBottomNav(which){
  document.querySelectorAll('.bn-btn').forEach(b=>b.classList.remove('on'));
  const btn = which && document.getElementById('bn-'+which);
  if(btn) btn.classList.add('on');
}

// ─── Shareable match links ──────────────────────────────────────
// openMatch()/goHome() keep the URL's ?fixture= param in sync (via
// history.replaceState, so it doesn't spam browser back/forward history),
// and the DOMContentLoaded handler checks for that param on first load to
// deep-link straight into a match. copyMatchLink() puts that URL on the
// clipboard for the "Share" button in the match header.
function matchLinkFor(fid){
  const url = new URL(location.href);
  url.searchParams.set('fixture', fid);
  return url.toString();
}
async function copyMatchLink(fid, btn){
  const link = matchLinkFor(fid);
  const flash = (label) => {
    if(!btn) return;
    const orig = btn.innerHTML;
    btn.innerHTML = `<i class="ti ti-check"></i> ${label}`;
    setTimeout(()=>{ btn.innerHTML = orig; }, 1800);
  };
  try{
    await navigator.clipboard.writeText(link);
    flash('Copied!');
  }catch(e){
    // Clipboard API needs a secure context (https) and can be unavailable
    // over file:// or in some embedded views — fall back to a manual-copy
    // prompt rather than silently failing.
    window.prompt('Copy this link:', link);
  }
}
// Escape closes the mobile sidebar drawer — the backdrop itself is not a
// focusable control (a full-page invisible tab-stop would be worse for
// keyboard users than not having one), so Escape is the keyboard equivalent.
document.addEventListener('keydown',(e)=>{
  if(e.key==='Escape' && document.getElementById('sb')?.classList.contains('sb-open')) closeSidebar();
});

// ─── Keyboard activation for onclick-only cards ────────────────
// A number of list items (fixture rows, player cards, etc.) are plain
// <div role="button" tabindex="0" onclick="..."> rather than real <button>
// elements, so they need Enter/Space to trigger the same action a click
// would. Space is prevented from also scrolling the page.
function _kbActivate(e){
  if(e.key==='Enter' || e.key===' ' || e.key==='Spacebar'){
    e.preventDefault();
    e.currentTarget.click();
  }
}

// Moves keyboard/screen-reader focus to a top-level view's own container
// right after it's switched in. #landing/#mv/#lg/#clubsearch/#club all
// carry tabindex="-1" for exactly this — without it, focus silently stays
// wherever it was on the PREVIOUS view (often a now-hidden or about-to-be
// re-rendered element), so a screen-reader user gets no cue that the page
// changed underneath them, and a keyboard user's next Tab press resumes
// from a stale, invisible position instead of the top of the new view.
function focusView(id){
  try{ document.getElementById(id)?.focus({preventScroll:true}); }catch(e){}
}
// Season-analysis cards additionally expose their expand/collapse state via
// aria-expanded so screen readers announce it.
function _toggleSaCard(el){
  const open = el.classList.toggle('open');
  el.setAttribute('aria-expanded', open ? 'true' : 'false');
}
// Match view's Back button — see the _matchReturnTo note in openMatch().
function backFromMatch(){
  if(_matchReturnTo==='club' && _matchReturnClubId!=null) openClub(_matchReturnClubId);
  else goHome();
}
function backFromClub(){
  if(_clubReturnTo==='leagues') openLeagues();
  else openClubSearch();
}
function goHome(){
  _activeId=null;
  _leaguesOpen=false;
  _activeClubId=null;
  _clubSearchOpen=false;
  if(_refreshTmr){clearInterval(_refreshTmr);_refreshTmr=null;}
  document.getElementById('landing').style.display='flex';
  document.getElementById('mv').style.display='none';
  const lgEl=document.getElementById('lg'); if(lgEl)lgEl.style.display='none';
  const clubEl=document.getElementById('club'); if(clubEl)clubEl.style.display='none';
  const csEl=document.getElementById('clubsearch'); if(csEl)csEl.style.display='none';
  document.querySelectorAll('.fix-row').forEach(el=>el.classList.remove('on'));
  // Drop the ?fixture= param so the URL matches what's actually showing.
  try{
    const url = new URL(location.href);
    url.searchParams.delete('fixture');
    history.replaceState(null, '', url.toString());
  }catch(e){}
  renderLanding();
  syncBottomNav('home');
  focusView('landing');
}

// ═══════════════════════════════════════════════════════════════
// SECTION 15 — LANDING PAGE
// ═══════════════════════════════════════════════════════════════
function renderLanding(){
  const el=document.getElementById('landing');
  // Don't update landing if a match is currently open
  if(_activeId)return;
  const fixtures=_fixturesCache;
  const d=selDate();

  if(!fixtures.length){
    // Three genuinely different states used to render as the same "Loading…"
    // message: still in flight, a real failure, and a confirmed-empty day.
    // A failed load with no error surfaced here is what made the dashboard
    // look like it "doesn't load" with no explanation on first open.
    if(_landingErrMsg){
      el.innerHTML=`<div class="lp-empty">
        <i class="ti ti-alert-triangle" style="color:var(--high)"></i>
        <div>${_landingErrMsg}</div>
        ${retryBtn('Retry', 'loadFixtures()')}
      </div>`;
    } else if(_fixturesFetchDone){
      el.innerHTML=`<div class="lp-empty">
        <i class="ti ti-calendar-off"></i>
        <div>No fixtures found for ${dayLabel(d)}.</div>
      </div>`;
    } else {
      el.innerHTML=`<div class="lp-empty">
        <div class="spnr"></div>
        <div>Loading fixtures for ${dayLabel(d)}…</div>
      </div>`;
    }
    return;
  }

  // Filter: tracked leagues only — see TRACKED_LEAGUES. Computed BEFORE the
  // hero stats below, so "Live now"/"Upcoming"/"Total today" count the same
  // tracked-league set the cards actually show, not all ~700 fixtures
  // worldwide that a busy day's unfiltered /fixtures?date= response contains.
  const euroFixtures = fixtures.filter(isTrackedLeague);
  const live=euroFixtures.filter(f=>isLive(f.fixture.status.short));
  const upcoming=euroFixtures.filter(f=>!isLive(f.fixture.status.short)&&!isFinal(f.fixture.status.short));
  // Apply league dropdown filter if set
  const visible = _leagueFilter
    ? euroFixtures.filter(f=>f.league.id===_leagueFilter)
    : euroFixtures;

  // Group by league
  const groups={};
  for(const f of visible){
    const key=f.league.id+'_'+f.league.name;
    if(!groups[key])groups[key]={name:f.league.name,country:f.league.country,id:f.league.id,items:[]};
    groups[key].items.push(f);
  }

  // Sort groups: live first, then English-first priority, then European rest
  const sortedGroups=Object.values(groups).sort((a,b)=>{
    const aL=a.items.some(f=>isLive(f.fixture.status.short));
    const bL=b.items.some(f=>isLive(f.fixture.status.short));
    if(aL&&!bL)return-1;if(!aL&&bL)return 1;
    return leagueSort(a)-leagueSort(b);
  });

  const heroHtml=`<div class="lp-hero">
    <div style="display:flex;align-items:center;gap:12px">
      <div class="sb-hamburger" onclick="openSidebar()" title="Open menu" role="button" tabindex="0" onkeydown="_kbActivate(event)"><i class="ti ti-menu-2"></i> Menu</div>
      <div>
        <h1 class="lp-logo"><i class="ti ti-shield-bolt"></i>Banits Betting</h1>
        <div class="lp-tagline">${dayLabel(d)} · Match analysis & card probability</div>
      </div>
    </div>
    <div class="lp-hero-stats">
      ${live.length?`<div class="lp-hstat"><div class="lp-hstat-n" style="color:var(--high)">${live.length}</div><div class="lp-hstat-l">Live now</div></div>`:''}
      <div class="lp-hstat"><div class="lp-hstat-n">${upcoming.length}</div><div class="lp-hstat-l">Upcoming</div></div>
      <div class="lp-hstat"><div class="lp-hstat-n" style="color:var(--dim)">${euroFixtures.length}</div><div class="lp-hstat-l">Total today</div></div>
    </div>
  </div>`;

  const groupsHtml=sortedGroups.map(g=>{
    const items=[...g.items].sort((a,b)=>{
      if(isLive(a.fixture.status.short)&&!isLive(b.fixture.status.short))return-1;
      if(!isLive(a.fixture.status.short)&&isLive(b.fixture.status.short))return 1;
      if(isFinal(a.fixture.status.short)&&!isFinal(b.fixture.status.short))return 1;
      if(!isFinal(a.fixture.status.short)&&isFinal(b.fixture.status.short))return-1;
      return new Date(a.fixture.date)-new Date(b.fixture.date);
    });
    const comp=g.country&&g.country!=='World'?`${g.country} · ${g.name}`:g.name;
    const hasLive=items.some(f=>isLive(f.fixture.status.short));
    return`<div class="lp-section">
      <div class="lp-sec-hd">${hasLive?'<span class="live-pip" style="margin-right:4px">LIVE</span>':''} ${comp}</div>
      <div class="lp-grid">${items.map(renderLpCard).join('')}</div>
    </div>`;
  }).join('');

  // Build league dropdown from all European fixtures
  const leagueMap={};
  for(const f of euroFixtures){
    const id=f.league.id;
    if(!leagueMap[id]) leagueMap[id]={id,name:f.league.name,country:f.league.country,count:0};
    leagueMap[id].count++;
  }
  const leagueOptions = Object.values(leagueMap)
    .sort((a,b)=>leagueSort(a)-leagueSort(b))
    .map(l=>`<option value="${l.id}"${_leagueFilter===l.id?' selected':''}>${l.country&&l.country!=='World'?l.country+' · ':''} ${l.name} (${l.count})</option>`)
    .join('');

  const leagueDropdown=`<div class="lp-filter-row">
    <select class="lp-league-sel" onchange="setLeagueFilter(this.value?+this.value:null)">
      <option value="">All tracked leagues (${euroFixtures.length} matches)</option>
      ${leagueOptions}
    </select>
  </div>`;
  const toggleBtn='';

  // ── Your teams (watchlist) ─────────────────────────────────────
  // Uses the full unfiltered fixture list (not just euroFixtures) so a
  // favourited team still shows up here even in a cup fixture or
  // competition outside TRACKED_LEAGUES — deliberately not narrowed by the
  // 2026-08-23 league-limiting fix below, since the whole point of a
  // favourited team is to always surface its match regardless of competition.
  const favFixtures = _favTeams.size
    ? fixtures.filter(f=>_favTeams.has(f.teams.home.id)||_favTeams.has(f.teams.away.id))
    : [];
  const favHtml = favFixtures.length ? `<div class="lp-section lp-fav-section">
    <div class="lp-sec-hd"><i class="ti ti-star-filled" style="color:var(--gold);font-size:11px;margin-right:4px"></i> Your teams</div>
    <div class="lp-grid">${favFixtures.map(renderLpCard).join('')}</div>
  </div>` : '';

  el.innerHTML=`${heroHtml}${buildLiveSpotlight(live)}<div class="lp-body">
    <!-- CENTER: fixtures with dropdown -->
    <div class="lp-main">${favHtml}${leagueDropdown}${groupsHtml}${toggleBtn}</div>
    <!-- RIGHT: WC widget + setup + results -->
    <div class="lp-results-col">
      <div class="lp-sec-hd" style="margin-top:14px"><i class="ti ti-ball-football" style="color:var(--gold)"></i> Results</div>
      <div id="lp-results-list"><div class="ld-msg" style="padding:16px 0"><div class="spnr"></div>Loading…</div></div>
    </div>
  </div>`;

  loadResultsPanel();
}

// Batch-fetches events (goals, red cards) for today's finished/live matches
// using ONE call to /fixtures?ids=a-b-c... (API-Football returns embedded
// events for each fixture in this multi-ID request, same as a single
// /fixtures?id= call). Live matches first, then most recently kicked off.
let _resultsCache = { key:null, byId:{}, ts:0 }; // skips redundant /fixtures?ids= calls when the exact same live/final candidate batch would be requested again (e.g. filter-only re-renders). Short TTL so live scores/elapsed time still refresh — this only kills the *duplicate* fetch, not the periodic one.
const RESULTS_CACHE_TTL = 15000; // 15s — matches the worker's own edge-cache window for /fixtures?ids= lookups, so a cache miss here still hits a warm edge cache

async function loadResultsPanel(){
  const container=document.getElementById('lp-results-list');
  if(!container)return;
  const fixtures=_fixturesCache;
  // Filter: tracked leagues only — see TRACKED_LEAGUES
  const euroFixtures = fixtures.filter(isTrackedLeague);
  // Apply league dropdown filter if set
  const visible = _leagueFilter
    ? euroFixtures.filter(f=>f.league.id===_leagueFilter)
    : euroFixtures;
  const candidates=visible.filter(f=>isLive(f.fixture.status.short)||isFinal(f.fixture.status.short));

  if(!candidates.length){
    container.innerHTML=`<div class="no-data" style="padding:24px 10px"><i class="ti ti-ball-off"></i>No results yet today.<br><span style="font-size:10px">Check back once matches kick off.</span></div>`;
    return;
  }

  candidates.sort((a,b)=>{
    const aL=isLive(a.fixture.status.short), bL=isLive(b.fixture.status.short);
    if(aL&&!bL)return-1; if(!aL&&bL)return 1;
    return new Date(b.fixture.date)-new Date(a.fixture.date);
  });
  const top=candidates.slice(0,18); // API-Football multi-ID limit
  const ids=top.map(f=>f.fixture.id).join('-');

  let byId;
  if(_resultsCache.key===ids && (Date.now()-_resultsCache.ts)<RESULTS_CACHE_TTL){
    byId=_resultsCache.byId; // identical candidate batch, fetched recently — skip the network round trip
  } else {
    const data=await afFetch(`/fixtures?ids=${ids}`);
    byId={};
    for(const fx of (data?.response||[])) byId[fx.fixture.id]=fx;
    _resultsCache={key:ids,byId,ts:Date.now()};
  }

  container.innerHTML=top.map(f=>buildResultCard(byId[f.fixture.id]||f)).join('');
  if(candidates.length>top.length){
    container.innerHTML+=`<div style="text-align:center;font-size:9px;color:var(--dim);padding:8px 0">+ ${candidates.length-top.length} more results</div>`;
  }
}

function buildResultCard(fx){
  const ht=tinfo(fx.teams.home.name), at=tinfo(fx.teams.away.name);
  const live=isLive(fx.fixture.status.short);
  const events=fx.events||[];
  const hId=fx.teams.home.id;

  // Merge goals + red cards, sorted chronologically
  const notable=events
    .filter(e=>e.type==='Goal'||(e.type==='Card'&&(e.detail||'').includes('Red')))
    .sort((a,b)=>((a.time.elapsed||0)+(a.time.extra||0))-((b.time.elapsed||0)+(b.time.extra||0)));

  const evRow=(e)=>{
    const t=e.time.extra?`${e.time.elapsed}+${e.time.extra}`:e.time.elapsed;
    const isHome=e.team.id===hId;
    const isGoal=e.type==='Goal';
    const og=e.detail==='Own Goal';
    const icon=isGoal?'⚽':'🟥';
    const name=`${e.player?.name||'?'}${og?' (OG)':''}`;
    return`<div class="lpr-ev${isHome?'':' away'}">
      ${isHome?`<span class="lpr-ev-ico">${icon}</span><span>${name}</span><b>${t}'</b>`
              :`<b>${t}'</b><span>${name}</span><span class="lpr-ev-ico">${icon}</span>`}
    </div>`;
  };

  return`<div class="lpr-card${live?' lpr-live':''}" onclick="openMatch(${fx.fixture.id})" role="button" tabindex="0" onkeydown="_kbActivate(event)">
    <div class="lpr-teams">
      <span class="lpr-tm">${badge(fx.teams.home.logo,'sm',fx.teams.home.name)}<span class="lpr-tm-nm" style="color:${ht.c}">${fx.teams.home.name}</span></span>
      <span class="lpr-sc${live?' live-sc':''}">${fx.goals.home}&ndash;${fx.goals.away}</span>
      <span class="lpr-tm away"><span class="lpr-tm-nm" style="color:${at.c}">${fx.teams.away.name}</span>${badge(fx.teams.away.logo,'sm',fx.teams.away.name)}</span>
    </div>
    <div class="lpr-status">${live?`<span class="live-pip">LIVE${fx.fixture.status.elapsed?' '+fx.fixture.status.elapsed+"'":''}</span>`:'Full time'}</div>
    ${notable.length?`<div class="lpr-events">${notable.map(evRow).join('')}</div>`:''}
  </div>`;
}

function renderLpCard(f){
  const ht=tinfo(f.teams.home.name);
  const at=tinfo(f.teams.away.name);
  const live=isLive(f.fixture.status.short);
  const fin=isFinal(f.fixture.status.short);
  const hasScore=f.goals.home!==null;
  const score=hasScore?`${f.goals.home}–${f.goals.away}`:statusDisp(f);
  const cls=live?'lp-live':fin?'lp-fin':'';
  const statusTxt=live?`<span class="live-pip">LIVE</span><span>${f.fixture.status.elapsed?f.fixture.status.elapsed+"'":''}  </span>`
                  :fin?`<span>Full time</span>`
                  :`<span>${fmtTime(f.fixture.date)}</span>`;
  return`<div class="lp-card ${cls}" onclick="openMatch(${f.fixture.id})" role="button" tabindex="0" onkeydown="_kbActivate(event)">
    <div class="lp-card-row">
      ${badge(f.teams.home.logo,'sm',f.teams.home.name)}
      <span class="lp-tm" style="color:${ht.c}">${f.teams.home.name}</span>
      <span class="lp-sc${live?' live-sc':''}">${hasScore?score:'vs'}</span>
      <span class="lp-tm away" style="color:${at.c}">${f.teams.away.name}</span>
      ${badge(f.teams.away.logo,'sm',f.teams.away.name)}
    </div>
    <div class="lp-card-foot">${statusTxt}${live?`<span class="chip chip-live" style="font-size:7px">Live</span>`:''}</div>
  </div>`;
}

// Featured live-match banner — shown above the fixture grid whenever at
// least one tracked-league match is in play. Landing pages on FotMob/BBC
// Sport/most betting sites all give the day's live action a large, unique
// treatment instead of leaving it exactly the same size as a "vs" card
// nobody's watching yet — on a normal day here that's also literally the
// only above-the-fold thing worth a bigger presence, so this doubles as a
// simple fix for the large empty space a low-fixture day otherwise leaves
// under the fold. Picks the live match with the earliest kickoff (i.e. the
// one that's been live longest) if more than one is in play — arbitrary
// but stable, avoids the banner jumping between matches on every poll tick.
function buildLiveSpotlight(liveFixtures){
  if(!liveFixtures.length) return '';
  const fx = [...liveFixtures].sort((a,b)=>new Date(a.fixture.date)-new Date(b.fixture.date))[0];
  const ht=tinfo(fx.teams.home.name), at=tinfo(fx.teams.away.name);
  function h2r(hex,a){const r=(hex||'#0047b5').replace('#','').match(/.{2}/g)||['0','47','b5'];return`rgba(${r.map(x=>parseInt(x,16)).join(',')},${a})`;}
  const elapsed = fx.fixture.status.elapsed ? fx.fixture.status.elapsed+"'" : 'LIVE';
  const comp = fx.league.country && fx.league.country!=='World' ? `${fx.league.country} · ${fx.league.name}` : fx.league.name;
  const extra = liveFixtures.length>1 ? ` <span class="lp-spot-more">+${liveFixtures.length-1} more live</span>` : '';
  return`<div class="lp-spotlight" onclick="openMatch(${fx.fixture.id})" role="button" tabindex="0" onkeydown="_kbActivate(event)">
    <div class="lp-spot-bg" style="background:radial-gradient(1000px 260px at 15% 0%,${h2r(ht.c,.28)},transparent 60%),radial-gradient(1000px 260px at 85% 0%,${h2r(at.c,.28)},transparent 60%)"></div>
    <div class="lp-spot-lbl"><span class="live-pip">LIVE</span>${comp}${extra}</div>
    <div class="lp-spot-teams">
      <div class="lp-spot-team">${badge(fx.teams.home.logo,'lg',fx.teams.home.name)}<span class="lp-spot-nm" style="color:${ht.c}">${fx.teams.home.name}</span></div>
      <div class="lp-spot-ctr"><div class="lp-spot-sc">${fx.goals.home}&ndash;${fx.goals.away}</div><div class="lp-spot-min">${elapsed}</div></div>
      <div class="lp-spot-team away"><span class="lp-spot-nm" style="color:${at.c}">${fx.teams.away.name}</span>${badge(fx.teams.away.logo,'lg',fx.teams.away.name)}</div>
    </div>
  </div>`;
}
// ═══════════════════════════════════════════════════════════════
// SECTION 15b — LEAGUES (STANDINGS) VIEW
// ═══════════════════════════════════════════════════════════════
// A dedicated top-level tab for browsing any of the 9 tracked domestic
// leagues' full tables, independent of the day's fixture list. Reuses
// getStandingsTable() (SECTION 4) — its own cache means a league already
// looked up from a match's mini-table this session opens here instantly.
const LEAGUE_META = [
  {id:39,  name:'Premier League',  country:'England'},
  {id:40,  name:'Championship',    country:'England'},
  {id:41,  name:'League One',      country:'England'},
  {id:42,  name:'League Two',      country:'England'},
  {id:61,  name:'Ligue 1',         country:'France'},
  {id:140, name:'La Liga',         country:'Spain'},
  {id:78,  name:'Bundesliga',      country:'Germany'},
  {id:94,  name:'Primeira Liga',   country:'Portugal'},
  {id:135, name:'Serie A',         country:'Italy'},
];
let _activeLeagueId = 39;

function openLeagues(){
  if(_activeId){_activeId=null;if(_refreshTmr){clearInterval(_refreshTmr);_refreshTmr=null;}}
  _leaguesOpen=true;
  _activeClubId=null;
  _clubSearchOpen=false;
  document.getElementById('landing').style.display='none';
  document.getElementById('mv').style.display='none';
  document.getElementById('lg').style.display='flex';
  document.getElementById('lg').style.flexDirection='column';
  const clubEl=document.getElementById('club'); if(clubEl)clubEl.style.display='none';
  const csEl=document.getElementById('clubsearch'); if(csEl)csEl.style.display='none';
  document.querySelectorAll('.fix-row').forEach(el=>el.classList.remove('on'));
  try{ const url=new URL(location.href); url.searchParams.delete('fixture'); history.replaceState(null,'',url.toString()); }catch(e){}
  renderLeaguesNav();
  loadLeagueStandings(_activeLeagueId);
  syncBottomNav('leagues');
  focusView('lg');
}

function renderLeaguesNav(){
  const nav=document.getElementById('lg-tabs');
  if(!nav)return;
  nav.innerHTML=LEAGUE_META.map(lg=>
    `<button class="tab-btn${lg.id===_activeLeagueId?' on':''}" onclick="switchLeagueTab(${lg.id})">${lg.name}<span style="color:var(--dim);font-weight:400;margin-left:4px">${lg.country}</span></button>`
  ).join('');
}

function switchLeagueTab(id){
  _activeLeagueId=id;
  renderLeaguesNav();
  loadLeagueStandings(id);
}

async function loadLeagueStandings(leagueId){
  const body=document.getElementById('lg-body');
  if(!body)return;
  body.innerHTML='<div class="ld-msg"><div class="spnr"></div>Loading table…</div>';
  // A standings table is always exactly one season — 'both' mode has no
  // meaning here, so it resolves to the current club season (see
  // numericSeason()) rather than producing NaN.
  const season=numericSeason();
  const table=await getStandingsTable(leagueId, season);
  // The user may have switched tabs, seasons, or left the view entirely
  // while this was in flight — don't paint a stale table over whatever
  // they're looking at now.
  if(_activeLeagueId!==leagueId || !_leaguesOpen)return;
  if(!table || !table.length){
    body.innerHTML=`<div class="no-data" style="padding:32px 10px"><i class="ti ti-table-off"></i>Standings not available yet for this league/season.<br><span style="font-size:10px">Try the other season toggle in the sidebar, or check back once the season is underway.</span></div>`;
    return;
  }
  body.innerHTML=buildFullStandingsTable(table);
}

function buildFullStandingsTable(table, highlightTeamId){
  const rows=table.map(t=>{
    const form=(t.form||'').slice(-5).split('').map(r=>
      `<div class="mt-fb" style="background:${r==='W'?'#16a34a':r==='L'?'#dc2626':r==='D'?'#ca8a04':'transparent'}" title="${r||'?'}"></div>`
    ).join('');
    const hl = highlightTeamId!=null && t.team.id===highlightTeamId;
    // Rows link into the club page (SECTION 15c) — a lightweight way to
    // browse peer clubs in the same table, WhoScored-style.
    return`<div class="lg-row${hl?' lg-row-hl':''}" onclick="openClub(${t.team.id})" role="button" tabindex="0" onkeydown="_kbActivate(event)">
      <span class="lg-pos">${t.rank}</span>
      <span class="lg-team">${badge(t.team.logo,'sm',t.team.name)}<span class="lg-team-nm">${t.team.name}</span></span>
      <span class="lg-n">${t.all.played}</span>
      <span class="lg-n">${t.all.win}</span>
      <span class="lg-n">${t.all.draw}</span>
      <span class="lg-n">${t.all.lose}</span>
      <span class="lg-n lg-n-dim lg-n-opt">${t.all.goals.for}</span>
      <span class="lg-n lg-n-dim lg-n-opt">${t.all.goals.against}</span>
      <span class="lg-n lg-n-dim lg-n-opt">${t.goalsDiff>=0?'+':''}${t.goalsDiff}</span>
      <span class="lg-pts">${t.points}</span>
      <div class="lg-form">${form}</div>
    </div>`;
  }).join('');
  return`<div class="lg-table">
    <div class="lg-row lg-head">
      <span class="lg-pos">#</span>
      <span class="lg-team">Team</span>
      <span class="lg-n">P</span>
      <span class="lg-n">W</span>
      <span class="lg-n">D</span>
      <span class="lg-n">L</span>
      <span class="lg-n lg-n-opt">GF</span>
      <span class="lg-n lg-n-opt">GA</span>
      <span class="lg-n lg-n-opt">GD</span>
      <span class="lg-pts">Pts</span>
      <div class="lg-form">Form</div>
    </div>
    ${rows}
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 15c — CLUB SEARCH + CLUB PAGE
// ═══════════════════════════════════════════════════════════════
// Search is scoped to the 9 tracked leagues (LEAGUE_META) — this needs no
// new API endpoint at all: every club in scope already comes back from the
// /standings calls the app makes today (getStandingsTable(), same cache
// the Leagues view uses). The index is a flat, client-side list built once
// (promise-cached the same way getTeamLast5()/getFixturePlayerBoxes() are)
// and re-searched on every keystroke — cheap since it's just an in-memory
// substring filter, not a network call.
let _clubIndex = null;
let _clubIndexPromise = null;
async function buildClubIndex(){
  if(_clubIndex) return _clubIndex;
  if(_clubIndexPromise) return _clubIndexPromise;
  _clubIndexPromise = (async()=>{
    const season = numericSeason();
    const tables = await Promise.all(LEAGUE_META.map(lg=>getStandingsTable(lg.id, season)));
    const idx = [];
    tables.forEach((table,i)=>{
      const lg = LEAGUE_META[i];
      (table||[]).forEach(t=>idx.push({
        id:t.team.id, name:t.team.name, logo:t.team.logo,
        leagueId:lg.id, leagueName:lg.name, country:lg.country,
      }));
    });
    // Only cache a real, non-empty result. An empty list here virtually
    // always means every /standings call failed (network blip, rate
    // limit) — 9 major leagues never genuinely have zero teams between
    // them — so a transient failure must not poison the cache forever
    // (previously it did: _clubIndex was set unconditionally, so one bad
    // network moment on the FIRST search permanently broke Club Search —
    // "No club found" for every query — for the rest of the session).
    if(idx.length) _clubIndex = idx;
    _clubIndexPromise = null; // let the next call retry either way
    return idx;
  })();
  return _clubIndexPromise;
}

// Promise-cached the same way getTeamLast5() is (SECTION 4d) — without
// this, re-opening a club (e.g. clicking its own highlighted row in its
// own league table, or the same search result twice) re-issued both of
// these calls from scratch every time.
const _clubUpcomingCache = new Map(); // teamId → {promise, ts}
const _clubSquadCache = new Map();    // teamId → {promise, ts}
const CLUB_UPCOMING_TTL = TEAM_FORM_TTL; // 3 min — fixtures can get rescheduled
const CLUB_SQUAD_TTL = 600000;           // 10 min — a squad list doesn't change mid-session
function getTeamUpcoming(teamId){
  const cached = _clubUpcomingCache.get(teamId);
  if(cached && (Date.now()-cached.ts) < CLUB_UPCOMING_TTL) return cached.promise;
  const promise = afFetch(`/fixtures?team=${teamId}&next=3`);
  _clubUpcomingCache.set(teamId, {promise, ts:Date.now()});
  return promise;
}
function getTeamSquad(teamId){
  const cached = _clubSquadCache.get(teamId);
  if(cached && (Date.now()-cached.ts) < CLUB_SQUAD_TTL) return cached.promise;
  const promise = afFetchErr(`/players/squads?team=${teamId}`);
  _clubSquadCache.set(teamId, {promise, ts:Date.now()});
  return promise;
}

function openClubSearch(){
  if(_activeId){_activeId=null;if(_refreshTmr){clearInterval(_refreshTmr);_refreshTmr=null;}}
  _leaguesOpen=false; _activeClubId=null; _clubSearchOpen=true;
  document.getElementById('landing').style.display='none';
  document.getElementById('mv').style.display='none';
  const lgEl=document.getElementById('lg'); if(lgEl)lgEl.style.display='none';
  const clubEl=document.getElementById('club'); if(clubEl)clubEl.style.display='none';
  document.getElementById('clubsearch').style.display='flex';
  document.getElementById('clubsearch').style.flexDirection='column';
  document.querySelectorAll('.fix-row').forEach(el=>el.classList.remove('on'));
  try{ const url=new URL(location.href); url.searchParams.delete('fixture'); history.replaceState(null,'',url.toString()); }catch(e){}
  syncBottomNav('search');
  const input=document.getElementById('club-search-input');
  const resultsEl=document.getElementById('club-search-results');
  if(input){ input.value=''; setTimeout(()=>input.focus(),50); }
  if(resultsEl) resultsEl.innerHTML = `<div class="no-data" style="padding:24px 10px"><i class="ti ti-search"></i>Search across the ${LEAGUE_META.length} tracked leagues — ${LEAGUE_META.map(l=>l.name).join(', ')}.</div>`;
  buildClubIndex(); // warm the index in the background so the first keystroke doesn't wait on it
}

let _clubSearchDebounce = null;
function onClubSearchInput(q){
  clearTimeout(_clubSearchDebounce);
  _clubSearchDebounce = setTimeout(()=>renderClubSearchResults(q), 120);
}

async function renderClubSearchResults(q){
  const resultsEl=document.getElementById('club-search-results');
  if(!resultsEl) return;
  const query=(q||'').trim();
  if(query.length<2){
    resultsEl.innerHTML = `<div class="no-data" style="padding:24px 10px"><i class="ti ti-search"></i>Type at least 2 characters to search.</div>`;
    return;
  }
  resultsEl.innerHTML = `<div class="ld-msg"><div class="spnr"></div>Searching…</div>`;
  const index = await buildClubIndex();
  // The user may have kept typing (or left the search view) while the
  // index was loading — don't paint stale results over whatever's current.
  const liveInput = document.getElementById('club-search-input');
  if(!liveInput || liveInput.value.trim()!==query || !_clubSearchOpen) return;
  const ql=query.toLowerCase();
  const matches = index.filter(c=>c.name.toLowerCase().includes(ql)).slice(0,20);
  if(!matches.length){
    resultsEl.innerHTML = `<div class="no-data" style="padding:24px 10px"><i class="ti ti-info-circle"></i>No club found matching "${query}" in the tracked leagues.</div>`;
    return;
  }
  resultsEl.innerHTML = matches.map(c=>`
    <div class="club-search-row" onclick="openClub(${c.id})" role="button" tabindex="0" onkeydown="_kbActivate(event)">
      ${badge(c.logo,'sm',c.name)}
      <span class="club-search-nm">${c.name}</span>
      <span class="club-search-lg">${c.leagueName}</span>
    </div>`).join('');
}

// ─── The club page itself ────────────────────────────────────────
function buildClubHeaderShell(entry, info, rank, totalTeams){
  function h2r(hex,a){const r=(hex||'#0047b5').replace('#','').match(/.{2}/g)||['0','47','b5'];return`rgba(${r.map(x=>parseInt(x,16)).join(',')},${a})`;}
  const grad=h2r(info.c,0.16);
  const posTxt = rank ? `${ordinal(rank.rank)} of ${totalTeams} &middot; ${rank.points} pts` : '';
  // Oversized, faded crest watermark — the same "team identity fills the
  // header" treatment FotMob/BBC Sport club pages use. Purely decorative
  // (aria-hidden), so a missing/broken badge URL just means no watermark,
  // never broken layout or alt-text noise.
  const watermark = entry.logo ? `<div class="club-hero-watermark" style="background-image:url('${entry.logo}')" aria-hidden="true"></div>` : '';
  return`<div>
    <div class="mv-hdr-grad" style="background:radial-gradient(circle at 15% 20%,${grad} 0%,transparent 60%)"></div>
    ${watermark}
    <div class="mv-hdr-top-bar" style="background:${info.c}"></div>
    <div class="mh-comp">
      <button class="btn-back" onclick="backFromClub()" title="Back"><i class="ti ti-arrow-left"></i> Back</button>
      <div class="sb-hamburger" onclick="openSidebar()" title="Open menu" role="button" tabindex="0" onkeydown="_kbActivate(event)"><i class="ti ti-menu-2"></i> Menu</div>
      <i class="ti ti-shield"></i>${entry.leagueName}
      ${posTxt?`<span class="chip chip-ns">${posTxt}</span>`:''}
    </div>
    <div class="club-hero">
      ${badge(entry.logo,'lg',entry.name)}
      <div>
        <h1 class="club-hero-nm" style="color:${info.c}">${entry.name}</h1>
        <div class="club-hero-sub">${entry.country} &middot; ${entry.leagueName}</div>
      </div>
    </div>
  </div>`;
}

// Traditional stats + the same card-probability model shown everywhere
// else in the app — deliberately NOT a call into buildSaCard(): that
// function reads match-specific globals (_currentInjuries/_currentRefFactor)
// that have no meaning on a season-wide squad list with no single fixture
// in view, so this is a dedicated (smaller) renderer sharing the same
// `.sa-*` CSS classes for a visually-consistent card at zero new CSS cost.
function buildClubSquadCard(p){
  const probNull = p.prob===null || p.foulsMissing || p.noData;
  const pct = probNull ? null : Math.round(p.prob*100);
  const cls = pct!==null ? probColor(pct) : '';
  const barCol = pct!==null ? probBarColor(pct) : 'var(--dim)';
  const initials=(p.name||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  const photoEl=p.photo
    ?`<img src="${p.photo}" alt="${p.name}" class="sa-avatar" loading="lazy" onerror="this.outerHTML='<div class=\\'sa-avatar-ph\\'>${initials}</div>'">`
    :`<div class="sa-avatar-ph">${initials}</div>`;
  const ringPct = pct!==null ? Math.min(pct,100) : 0; // raw %, not the bar's ×2 scale — see buildSaCard()'s comment on this
  const ringCol = pct!==null ? barCol : 'var(--dim)';
  const avatarRing = `<div class="sa-avatar-ring" style="--pct:${ringPct};--ring-col:${ringCol}">${photoEl}</div>`;
  const noDataWarn = p.noData ? `<span style="font-size:9px;color:var(--dim);margin-left:5px">⚠ No data found</span>` : '';
  const seasonTxt = p.srcSeason && p.srcSeason!=='both' ? `${p.srcSeason}/${String(p.srcSeason+1).slice(2)}` : (p.srcSeason==='both'?'combined seasons':'');
  return`<div class="sa-card${p.noData?' no-data-card':''}">
    <div class="sa-top">
      ${avatarRing}
      <div style="min-width:0;flex:1;display:flex;align-items:center;flex-wrap:wrap;gap:4px">
        ${p.number?`<span class="sa-kit-num">${p.number}</span>`:''}
        <span class="sa-nm">${p.name}</span>
        <span class="sa-pos-badge pos-${p.pos}">${p.posL}</span>
        ${noDataWarn}
      </div>
      <span class="sa-pct ${cls}" style="flex-shrink:0">${pct!==null?pct+'%':'—'}</span>
    </div>
    <div class="sa-bar"><div class="sa-bar-fill" style="--bw:${pct!==null?Math.min(pct/50*100,100):0}%;width:var(--bw);background:${barCol};${probNull?'opacity:.5':''}"></div></div>
    <div class="sa-meta">
      <span>Apps <b>${p.apps}</b></span>
      <span>Goals <b>${p.goals||0}</b></span>
      <span>Assists <b>${p.assists||0}</b></span>
      <span>Mins <b>${p.mins}</b></span>
    </div>
    <div class="sa-meta" style="margin-top:4px">
      <span>FC/90 <b>${p.fp90.toFixed(1)}</b></span>
      <span>YC <b>${p.yc}/${p.apps}</b></span>
      <span style="color:var(--dim);font-size:9px;margin-left:auto">${seasonTxt}</span>
    </div>
  </div>`;
}

async function openClub(teamId){
  // Re-clicking the currently-open club's own row (e.g. its highlighted
  // row in its own league table) is a no-op — skip the loading-state
  // flash and a redundant re-render. The underlying data calls are all
  // cached regardless (see getTeamUpcoming/getTeamSquad above), so this
  // is purely about not churning the DOM for nothing.
  if(_activeClubId===teamId && document.getElementById('club')?.style.display==='flex') return;
  // Remember where the club page's Back button should go — openClub() is
  // reachable from Club Search, the Leagues tab, AND from a row inside
  // another club's own league-table panel (peer-club browsing keeps
  // whatever got us here in the first place, so Back doesn't ping-pong).
  if(_leaguesOpen) _clubReturnTo='leagues';
  else if(!_activeClubId) _clubReturnTo='search';
  if(_refreshTmr){clearInterval(_refreshTmr);_refreshTmr=null;}
  _activeId=null; _leaguesOpen=false; _clubSearchOpen=false; _activeClubId=teamId;
  document.getElementById('landing').style.display='none';
  document.getElementById('mv').style.display='none';
  const lgEl=document.getElementById('lg'); if(lgEl)lgEl.style.display='none';
  const csEl=document.getElementById('clubsearch'); if(csEl)csEl.style.display='none';
  document.getElementById('club').style.display='flex';
  document.getElementById('club').style.flexDirection='column';
  document.querySelectorAll('.fix-row').forEach(el=>el.classList.remove('on'));
  try{ const url=new URL(location.href); url.searchParams.delete('fixture'); history.replaceState(null,'',url.toString()); }catch(e){}
  syncBottomNav(null); // a club page is a drill-in, like a match — not one of the bar's own top-level destinations
  document.getElementById('club-hdr').innerHTML = `<div class="ld-msg"><div class="spnr"></div>Loading club…</div>`;
  document.getElementById('club-body').innerHTML = '';
  focusView('club');
  await loadClubPage(teamId);
}

async function loadClubPage(teamId){
  const hdrEl=document.getElementById('club-hdr');
  const bodyEl=document.getElementById('club-body');
  if(!hdrEl||!bodyEl) return;

  const index = await buildClubIndex();
  if(_activeClubId!==teamId) return; // navigated away while the index was loading
  const entry = index.find(c=>c.id===teamId);
  if(!entry){
    hdrEl.innerHTML = `<div class="ld-msg" style="color:var(--high)">Couldn't find this club in the tracked leagues.<br>${retryBtn('Back to search','openClubSearch()')}</div>`;
    bodyEl.innerHTML='';
    return;
  }

  const season = numericSeason();
  const info = tinfo(entry.name);
  hdrEl.innerHTML = buildClubHeaderShell(entry, info); // shell first — position fills in once standings resolve below

  const [table, last5, next3, squadRes] = await Promise.all([
    getStandingsTable(entry.leagueId, season),
    getTeamLast5(teamId),
    getTeamUpcoming(teamId),
    getTeamSquad(teamId),
  ]);
  if(_activeClubId!==teamId) return; // navigated away mid-flight

  const rank = table?.find(t=>t.team.id===teamId);
  hdrEl.innerHTML = buildClubHeaderShell(entry, info, rank, table?.length);

  let bodyHtml = '';
  if(table && table.length){
    bodyHtml += `<div class="ctx-panel">
      <div class="ctx-sec-hd"><i class="ti ti-table" style="font-size:11px"></i> ${entry.leagueName} table</div>
      ${buildFullStandingsTable(table, teamId)}
    </div>`;
  } else {
    // Distinct, visible failure state — previously a failed/empty standings
    // fetch just silently dropped the whole table panel with no explanation,
    // unlike every other data source on this page. Retries via
    // loadClubPage() directly, not openClub() — the club is already open,
    // so openClub()'s same-club no-op guard would otherwise swallow the click.
    bodyHtml += `<div class="no-data" style="padding:16px">
      <i class="ti ti-alert-triangle" style="color:var(--med)"></i>${entry.leagueName} table could not be loaded.
      ${retryBtn('Retry', `loadClubPage(${teamId})`)}
    </div>`;
  }

  const recent=(last5?.response||[]).slice().reverse(); // API returns oldest→newest; most-recent-first reads better
  const upcoming=next3?.response||[];
  bodyHtml += `<div class="two-col">
    <div><h2 class="stitle"><i class="ti ti-history"></i>Recent results</h2>
      ${recent.length ? recent.map(renderLpCard).join('') : `<div class="no-data" style="padding:16px"><i class="ti ti-calendar-off"></i>No recent results found.</div>`}
    </div>
    <div><h2 class="stitle"><i class="ti ti-calendar-event"></i>Upcoming fixtures</h2>
      ${upcoming.length ? upcoming.map(renderLpCard).join('') : `<div class="no-data" style="padding:16px"><i class="ti ti-calendar-off"></i>No upcoming fixtures scheduled yet.</div>`}
    </div>
  </div>`;

  // getTeamSquad() goes through afFetchErr(), so a genuine fetch failure is
  // distinguishable from "fetched fine, squad just happens to be empty" —
  // previously both cases rendered the same silent "no squad list" message.
  const squadData = squadRes?.data;
  const squadErr = squadRes?.error;
  const squadPlayers = squadData?.response?.[0]?.players || [];
  bodyHtml += `<h2 class="stitle"><i class="ti ti-users"></i>Squad</h2>
    <div id="club-squad-body">${squadPlayers.length
      ? `<div class="ld-msg"><div class="spnr"></div>Fetching club stats for ${squadPlayers.length} squad players — requests are rate-limited to ~1/sec, so this can take ${Math.ceil(squadPlayers.length*1.1/10)*10}–${Math.ceil(squadPlayers.length*1.4/10)*10}s…</div>`
      : squadErr
        ? `<div class="no-data" style="padding:16px">${afFailureMessage('Squad list could not be loaded', squadErr)}${retryBtn('Retry', `loadClubPage(${teamId})`)}</div>`
        : `<div class="no-data" style="padding:16px"><i class="ti ti-users"></i>No squad list available for this club yet.</div>`}</div>`;

  bodyEl.innerHTML = bodyHtml;
  if(_activeClubId!==teamId) return;

  if(squadPlayers.length){
    // Same blend/seasonChain convention as the match-view club path (SECTION
    // 4e) — previously this always queried just the single selected season,
    // so switching the sidebar to "Both" silently did nothing on this page.
    const blend = _seasonMode==='both';
    const seasonChain = blend ? [lastClubSeason()-1, lastClubSeason()] : [season];
    resetBreaker();
    const results = await fetchPlayersThrottled(squadPlayers, seasonChain, (done,total)=>{
      const el=document.getElementById('club-squad-body');
      if(el) el.innerHTML = `<div class="ld-msg"><div class="spnr"></div>Fetching player stats (${done}/${total})…</div>`;
    }, {blend});
    if(_activeClubId!==teamId) return; // navigated away while squad stats were loading
    if(_breakerTripped){
      const el=document.getElementById('club-squad-body');
      if(el) el.innerHTML = buildClubRateLimitMessage(teamId);
      return;
    }

    const order={G:0,D:1,M:2,F:3};
    const sorted=[...results].sort((a,b)=>(order[a.pos]??4)-(order[b.pos]??4) || (b.prob??-1)-(a.prob??-1));
    const groups=[['G','Goalkeepers'],['D','Defenders'],['M','Midfielders'],['F','Forwards']];
    let squadHtml='';
    for(const [code,label] of groups){
      const group=sorted.filter(p=>p.pos===code);
      if(!group.length) continue;
      squadHtml += `<div class="club-squad-grp-lbl">${label}</div><div class="club-squad-grid">${group.map(buildClubSquadCard).join('')}</div>`;
    }
    const rest=sorted.filter(p=>!groups.some(([code])=>code===p.pos));
    if(rest.length) squadHtml += `<div class="club-squad-grp-lbl">Other</div><div class="club-squad-grid">${rest.map(buildClubSquadCard).join('')}</div>`;
    const el=document.getElementById('club-squad-body');
    if(el) el.innerHTML = squadHtml || `<div class="no-data" style="padding:16px">No player stats available.</div>`;
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  // Sync season toggle button to saved preference. (Previously
  // `'stog-'+_seasonMode||'stog-2025'` — operator precedence meant the
  // `||'stog-2025'` fallback was dead code, since the concatenation is
  // always a non-empty, truthy string; harmless in practice since
  // _seasonMode already always defaults to a valid value, but fixed for
  // clarity while touching this code.)
  document.getElementById('stog-'+(_seasonMode||'2025'))?.classList.add('on');

  // Inject PWA manifest (inline blob so it works from any host or file://).
  // Wrapped on its own — a failure here (blocked by an extension, an odd
  // host's CSP, etc.) must never be able to stop the actual fixture load
  // below from running.
  try{
    const manifest={
      name:'Banits Betting',
      short_name:'Banits',
      description:'Football match analysis & card probability',
      start_url:'./',
      display:'standalone',
      background_color:'#02091C',
      theme_color:'#0047B5',
      orientation:'portrait-primary',
      icons:[
        {src:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='24' fill='%2302091C'/%3E%3Ccircle cx='96' cy='96' r='60' fill='none' stroke='%230047B5' stroke-width='8'/%3E%3Ctext x='96' y='110' text-anchor='middle' font-family='Arial Black,sans-serif' font-size='64' font-weight='900' fill='%23F0B323'%3EB%3C/text%3E%3C/svg%3E",sizes:'192x192',type:'image/svg+xml',purpose:'any maskable'},
        {src:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='64' fill='%2302091C'/%3E%3Ccircle cx='256' cy='256' r='160' fill='none' stroke='%230047B5' stroke-width='20'/%3E%3Ctext x='256' y='298' text-anchor='middle' font-family='Arial Black,sans-serif' font-size='180' font-weight='900' fill='%23F0B323'%3EB%3C/text%3E%3C/svg%3E",sizes:'512x512',type:'image/svg+xml',purpose:'any maskable'},
      ]
    };
    const blob=new Blob([JSON.stringify(manifest)],{type:'application/manifest+json'});
    const link=Object.assign(document.createElement('link'),{rel:'manifest',href:URL.createObjectURL(blob)});
    document.head.appendChild(link);
  }catch(e){
    console.warn('[Banits] PWA manifest injection failed (non-fatal):', e.message);
  }

  // Shareable-link deep link: ?fixture=<id> opens straight into that match.
  // Runs alongside loadFixtures(), not after it — openMatch() fetches its
  // own fixture data directly and doesn't need the day's fixture list first.
  let deepLinkId = null;
  try{
    const raw = new URL(location.href).searchParams.get('fixture');
    if(raw && /^\d+$/.test(raw)) deepLinkId = parseInt(raw,10);
  }catch(e){}

  loadFixtures();
  if(deepLinkId) openMatch(deepLinkId);

  // Background poll for the landing page. Skips itself whenever a refresh
  // would be wasted: a match or the Leagues tab is open (their own
  // refresh/cache logic covers those), the tab isn't visible, or every
  // tracked-league fixture today has already finished (nothing left to
  // change until tomorrow).
  setInterval(()=>{
    if(shouldPollFixtures())loadFixtures();
  },60000);

  // Catch up immediately when the user comes back to the tab, instead of
  // waiting up to 60s for the next interval tick.
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden && shouldPollFixtures())loadFixtures();
  });
});

function shouldPollFixtures(){
  if(_activeId||_leaguesOpen||_activeClubId||_clubSearchOpen)return false;
  if(document.hidden)return false;
  if(_fixturesCache.length){
    const tracked=_fixturesCache.filter(isTrackedLeague);
    if(tracked.length && tracked.every(f=>isFinal(f.fixture.status.short)))return false;
  }
  return true;
}
