@'
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

app.get('/api/live', async (req, res) => {
  try { res.json(await apiFetch('/fixtures?live=all')) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/fixtures', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0]
    const league = req.query.league ? `&league=${req.query.league}` : ''
    res.json(await apiFetch(`/fixtures?date=${date}${league}`))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/stats/:id', async (req, res) => {
  try { res.json(await apiFetch(`/fixtures/statistics?fixture=${req.params.id}`)) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/odds/:id', async (req, res) => {
  try { res.json(await apiFetch(`/fixtures/odds?fixture=${req.params.id}&bookmaker=6`)) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', keyConfigured: !!API_KEY })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Backend rodando na porta ${PORT}`))
'@ | Set-Content server.js -Encoding UTF8