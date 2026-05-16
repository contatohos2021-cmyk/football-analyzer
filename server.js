import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors({ origin: '*' }))

const API_KEY = process.env.API_FOOTBALL_KEY || ''

async function apiFetch(path) {
  const res = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: {
      'x-apisports-key': API_KEY,
      'x-rapidapi-key': API_KEY,
      'x-rapidapi-host': 'v3.football.api-sports.io'
    }
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

// ── PARTIDAS ──────────────────────────────────────────
// Partidas ao vivo
app.get('/api/live', async (req, res) => {
  try { res.json(await apiFetch('/fixtures?live=all')) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// Pré-jogo (hoje ou data específica)
app.get('/api/fixtures', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0]
    const league = req.query.league ? `&league=${req.query.league}` : ''
    res.json(await apiFetch(`/fixtures?date=${date}${league}`))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── ANÁLISE DA PARTIDA ────────────────────────────────
// Estatísticas detalhadas
app.get('/api/stats/:id', async (req, res) => {
  try { res.json(await apiFetch(`/fixtures/statistics?fixture=${req.params.id}`)) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// Odds (bet365 = bookmaker 6)
app.get('/api/odds/:id', async (req, res) => {
  try { res.json(await apiFetch(`/fixtures/odds?fixture=${req.params.id}&bookmaker=6`)) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// Escalações confirmadas
app.get('/api/lineups/:id', async (req, res) => {
  try { res.json(await apiFetch(`/fixtures/lineups?fixture=${req.params.id}`)) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// Eventos da partida (gols, cartões, substituições)
app.get('/api/events/:id', async (req, res) => {
  try { res.json(await apiFetch(`/fixtures/events?fixture=${req.params.id}`)) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// ── MODELO PRO — 12 PONTOS ────────────────────────────
// H2H — confrontos diretos entre dois times
app.get('/api/h2h/:h2hIds', async (req, res) => {
  try { res.json(await apiFetch(`/fixtures/headtohead?h2h=${req.params.h2hIds}&last=10`)) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// Forma recente de um time (últimos N jogos)
app.get('/api/form/:teamId', async (req, res) => {
  try {
    const league = req.query.league || ''
    const season = req.query.season || new Date().getFullYear()
    const last = req.query.last || 10
    const leagueParam = league ? `&league=${league}` : ''
    res.json(await apiFetch(`/fixtures?team=${req.params.teamId}&last=${last}&season=${season}${leagueParam}`))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Lesionados e suspensos
app.get('/api/injuries/:id', async (req, res) => {
  try { res.json(await apiFetch(`/injuries?fixture=${req.params.id}`)) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// Classificação da liga (contexto da partida)
app.get('/api/standings', async (req, res) => {
  try {
    const league = req.query.league || '71'
    const season = req.query.season || new Date().getFullYear()
    res.json(await apiFetch(`/standings?league=${league}&season=${season}`))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Previsão da partida (endpoint nativo da API-Football)
app.get('/api/prediction/:id', async (req, res) => {
  try { res.json(await apiFetch(`/predictions?fixture=${req.params.id}`)) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// ── HEALTH ────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', keyConfigured: !!API_KEY, endpoints: 11 })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`✅ Backend rodando na porta ${PORT}`)
  console.log(`🔑 API Key: ${API_KEY ? 'configurada' : 'NÃO configurada'}`)
  console.log(`📡 Endpoints disponíveis: 11`)
})