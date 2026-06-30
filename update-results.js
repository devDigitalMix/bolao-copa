// ──────────────────────────────────────────────────────────────
// Atualizador automático de resultados do Bolão da Copa
// Roda no GitHub Actions. Busca jogos encerrados na football-data.org
// e preenche gol_a / gol_b / finished na tabela "games" do Supabase.
//
// NÃO precisa de dependências: usa o fetch nativo do Node 20+.
//
// Variáveis de ambiente esperadas (configuradas como GitHub Secrets):
//   SUPABASE_URL          ex: https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  a chave "service_role" (NUNCA coloque no front!)
//   FOOTBALL_DATA_TOKEN   sua chave da football-data.org
// ──────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const FD_TOKEN     = process.env.FOOTBALL_DATA_TOKEN;
const COMPETITION  = process.env.FD_COMPETITION || 'WC'; // WC = Copa do Mundo

if (!SUPABASE_URL || !SUPABASE_KEY || !FD_TOKEN) {
  console.error('❌ Faltam variáveis de ambiente (SUPABASE_URL / SUPABASE_SERVICE_KEY / FOOTBALL_DATA_TOKEN).');
  process.exit(1);
}

// ── Dicionário de nomes: português / formas longas → nome canônico em inglês ──
// (a football-data.org usa nomes em inglês; seu app usa português com bandeirinha)
// Se faltar algum time, é só adicionar a linha aqui.
const ALIASES = {
  'brasil': 'brazil', 'argentina': 'argentina', 'franca': 'france',
  'inglaterra': 'england', 'espanha': 'spain', 'portugal': 'portugal',
  'alemanha': 'germany', 'holanda': 'netherlands', 'paises baixos': 'netherlands',
  'belgica': 'belgium', 'croacia': 'croatia', 'italia': 'italy',
  'uruguai': 'uruguay', 'colombia': 'colombia', 'mexico': 'mexico',
  'estados unidos': 'united states', 'eua': 'united states', 'usa': 'united states',
  'canada': 'canada', 'japao': 'japan', 'coreia do sul': 'korea republic',
  'korea republic': 'south korea', 'republic of korea': 'south korea',
  'marrocos': 'morocco', 'senegal': 'senegal', 'gana': 'ghana',
  'nigeria': 'nigeria', 'camaroes': 'cameroon', 'costa do marfim': 'ivory coast',
  'cote divoire': 'ivory coast', 'suica': 'switzerland', 'dinamarca': 'denmark',
  'polonia': 'poland', 'servia': 'serbia', 'australia': 'australia',
  'equador': 'ecuador', 'peru': 'peru', 'chile': 'chile', 'paraguai': 'paraguay',
  'arabia saudita': 'saudi arabia', 'catar': 'qatar', 'qatar': 'qatar',
  'ira': 'iran', 'iran': 'iran', 'ir iran': 'iran', 'tunisia': 'tunisia',
  'argelia': 'algeria', 'egito': 'egypt', 'noruega': 'norway', 'suecia': 'sweden',
  'austria': 'austria', 'turquia': 'turkey', 'turkiye': 'turkey', 'grecia': 'greece',
  'escocia': 'scotland', 'pais de gales': 'wales', 'gales': 'wales',
  'nova zelandia': 'new zealand', 'costa rica': 'costa rica', 'panama': 'panama',
  'jamaica': 'jamaica', 'honduras': 'honduras', 'cabo verde': 'cape verde',
  'africa do sul': 'south africa', 'uzbequistao': 'uzbekistan', 'jordania': 'jordan',
  // times novos da Copa 2026
  'rd congo': 'dr congo', 'republica democratica do congo': 'dr congo', 'rdc': 'dr congo',
  'tchequia': 'czechia', 'republica tcheca': 'czechia', 'czech republic': 'czechia',
  'bosnia e herzegovina': 'bosnia and herzegovina', 'bosnia herzegovina': 'bosnia and herzegovina',
  'iraque': 'iraq',
  'haiti': 'haiti'
};

// remove acentos, bandeirinhas/emojis e pontuação; deixa só letras minúsculas e espaços
function normalize(name) {
  return (name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acentos
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')                          // tira emoji/bandeira/pontuação
    .replace(/\s+/g, ' ')
    .trim();
}
function canon(name) {
  const n = normalize(name);
  return ALIASES[n] || n;
}
// chave do confronto independente da ordem dos times
function pairKey(a, b) {
  return [canon(a), canon(b)].sort().join(' | ');
}

const SUPA_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json'
};

async function getOpenGames() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/games?finished=eq.false&select=*`, { headers: SUPA_HEADERS });
  if (!r.ok) throw new Error('Supabase GET falhou: ' + r.status + ' ' + (await r.text()));
  return r.json();
}

async function getFinishedMatches() {
  const r = await fetch(
    `https://api.football-data.org/v4/competitions/${COMPETITION}/matches?status=FINISHED`,
    { headers: { 'X-Auth-Token': FD_TOKEN } }
  );
  if (!r.ok) throw new Error('football-data GET falhou: ' + r.status + ' ' + (await r.text()));
  const data = await r.json();
  return data.matches || [];
}

async function updateGame(id, golA, golB) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/games?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...SUPA_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ gol_a: golA, gol_b: golB, finished: true })
  });
  if (!r.ok) throw new Error('Supabase PATCH falhou: ' + r.status + ' ' + (await r.text()));
}

async function main() {
  const [openGames, matches] = await Promise.all([getOpenGames(), getFinishedMatches()]);
  console.log(`📋 ${openGames.length} jogo(s) em aberto no banco · ${matches.length} jogo(s) encerrado(s) na API`);

  // indexa os jogos da API pelo confronto (par de times)
  const apiByPair = new Map();
  for (const m of matches) {
    const home = m.homeTeam?.name, away = m.awayTeam?.name;
    const duration = m.score?.duration; // REGULAR | EXTRA_TIME | PENALTY_SHOOTOUT

    // Se foi para pênaltis, usar o placar antes dos pênaltis (empate na prorrogação).
    // A API pode retornar os gols de pênalti em fullTime; priorizamos extraTime/regularTime.
    let s;
    if (duration === 'PENALTY_SHOOTOUT') {
      const et = m.score?.extraTime;
      const rt = m.score?.regularTime;
      const ft = m.score?.fullTime;
      s = (et?.home != null) ? et : (rt?.home != null) ? rt : ft;
      console.log(`  [PENS] ${home} vs ${away} → duration=PENALTY_SHOOTOUT | extraTime=${JSON.stringify(et)} | regularTime=${JSON.stringify(rt)} | fullTime=${JSON.stringify(ft)} → usando ${JSON.stringify(s)}`);
    } else {
      s = m.score?.fullTime;
    }

    if (home == null || away == null || s?.home == null || s?.away == null) continue;
    console.log(`  [API] ${home} ${s.home} × ${s.away} ${away}  (canon: ${canon(home)} | ${canon(away)})`);
    apiByPair.set(pairKey(home, away), { home: canon(home), away: canon(away), hs: s.home, as: s.away });
  }

  let updated = 0;
  const unmatched = [];

  for (const g of openGames) {
    const hit = apiByPair.get(pairKey(g.team_a, g.team_b));
    if (!hit) { unmatched.push(g); continue; }

    // descobre a orientação: team_a do banco é o mandante ou o visitante na API?
    const aIsHome = canon(g.team_a) === hit.home;
    const golA = aIsHome ? hit.hs : hit.as;
    const golB = aIsHome ? hit.as : hit.hs;

    try {
      await updateGame(g.id, golA, golB);
      updated++;
      console.log(`✅ ${g.team_a} ${golA} × ${golB} ${g.team_b}  → atualizado`);
    } catch (e) {
      console.error(`⚠️  Falha ao atualizar ${g.team_a} × ${g.team_b}: ${e.message}`);
    }
  }

  console.log(`\n🏁 Concluído: ${updated} jogo(s) atualizado(s).`);
  if (unmatched.length) {
    console.log(`ℹ️  ${unmatched.length} jogo(s) em aberto ainda sem resultado correspondente (normal se o jogo não acabou, ou se o nome do time não bate com o dicionário):`);
    unmatched.forEach(g => console.log(`   • ${g.team_a} × ${g.team_b} (${g.date || 's/ data'})`));
  }
}

main().catch(e => { console.error('❌ Erro geral:', e.message); process.exit(1); });
