import express from 'express'
import cors from 'cors'

const app = express()

// CORS configurado para produção (aceita qualquer origem)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}))

app.use(express.json())

const API_KEY = process.env.API_FOOTBALL_KEY || ''

// ══════════════════════════════════════════════════════
// SISTEMA DE CACHE INTELIGENTE
// ══════════════════════════════════════════════════════
class SmartCache {
  constructor() {
    this.cache = new Map()
    this.TTL = {
      odds: 30 * 1000,        // 30s - odds mudam rápido
      liveStats: 45 * 1000,   // 45s - stats ao vivo
      fixtures: 60 * 1000,     // 1min - partidas do dia
      h2h: 60 * 60 * 1000,    // 1h - H2H não muda
      form: 60 * 60 * 1000,   // 1h - forma recente
      injuries: 2 * 60 * 60 * 1000,  // 2h - lesões
      standings: 6 * 60 * 60 * 1000,  // 6h - classificação
      prediction: 24 * 60 * 60 * 1000 // 24h - previsão
    }
  }

  set(key, value, type = 'default') {
    const ttl = this.TTL[type] || 60000
    this.cache.set(key, {
      value,
      expires: Date.now() + ttl,
      type
    })
  }

  get(key) {
    const item = this.cache.get(key)
    if (!item) return null
    if (Date.now() > item.expires) {
      this.cache.delete(key)
      return null
    }
    return item.value
  }

  clear(pattern) {
    if (pattern) {
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) this.cache.delete(key)
      }
    } else {
      this.cache.clear()
    }
  }

  stats() {
    let valid = 0, expired = 0
    const now = Date.now()
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expires) expired++
      else valid++
    }
    return { total: this.cache.size, valid, expired }
  }
}

const cache = new SmartCache()

// ══════════════════════════════════════════════════════
// HELPER: API FETCH COM RETRY
// ══════════════════════════════════════════════════════
async function apiFetch(path, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`https://v3.football.api-sports.io${path}`, {
        headers: {
          'x-apisports-key': API_KEY,
          'x-rapidapi-key': API_KEY,
          'x-rapidapi-host': 'v3.football.api-sports.io'
        }
      })
      if (!res.ok) {
        if (res.status === 429 && i < retries) {
          await new Promise(r => setTimeout(r, 1000 * (i + 1)))
          continue
        }
        throw new Error(`API error: ${res.status}`)
      }
      const data = await res.json()
      return data
    } catch (e) {
      if (i === retries) throw e
      await new Promise(r => setTimeout(r, 500 * (i + 1)))
    }
  }
}

// ══════════════════════════════════════════════════════
// ENDPOINT CORE: COLETA PRIORIZADA PARA TRADING
// ══════════════════════════════════════════════════════
app.post('/api/trading/collect', async (req, res) => {
  const { fixtureId, isLive } = req.body
  if (!fixtureId) return res.status(400).json({ error: 'fixtureId required' })

  try {
    const result = {
      fixtureId,
      timestamp: new Date().toISOString(),
      collected: {},
      cacheHits: {},
      errors: {}
    }

    // ────────────────────────────────────────────────────
    // PRIORIDADE 1: ODDS (BET365) - BASE PARA DECISÃO
    // ────────────────────────────────────────────────────
    const oddsKey = `odds:${fixtureId}`
    let odds = cache.get(oddsKey)
    
    if (!odds) {
      try {
        odds = await apiFetch(`/odds?fixture=${fixtureId}&bookmaker=6`)
        cache.set(oddsKey, odds, 'odds')
        result.collected.odds = true
      } catch (e) {
        result.errors.odds = e.message
        odds = { response: [] }
      }
    } else {
      result.cacheHits.odds = true
    }
    result.odds = odds.response?.[0] || null

    // ────────────────────────────────────────────────────
    // PRIORIDADE 2: STATS AO VIVO (se live)
    // ────────────────────────────────────────────────────
    if (isLive) {
      const statsKey = `stats:${fixtureId}`
      let stats = cache.get(statsKey)
      
      if (!stats) {
        try {
          stats = await apiFetch(`/fixtures/statistics?fixture=${fixtureId}`)
          cache.set(statsKey, stats, 'liveStats')
          result.collected.stats = true
        } catch (e) {
          result.errors.stats = e.message
          stats = { response: [] }
        }
      } else {
        result.cacheHits.stats = true
      }
      result.stats = stats.response || []

      // Events (gols, cartões) - importante para validar mercados
      const eventsKey = `events:${fixtureId}`
      let events = cache.get(eventsKey)
      
      if (!events) {
        try {
          events = await apiFetch(`/fixtures/events?fixture=${fixtureId}`)
          cache.set(eventsKey, events, 'liveStats')
          result.collected.events = true
        } catch (e) {
          result.errors.events = e.message
          events = { response: [] }
        }
      } else {
        result.cacheHits.events = true
      }
      result.events = events.response || []
    }

    // ────────────────────────────────────────────────────
    // PRIORIDADE 3: ESCALAÇÕES (se pré-jogo)
    // ────────────────────────────────────────────────────
    if (!isLive) {
      const lineupsKey = `lineups:${fixtureId}`
      let lineups = cache.get(lineupsKey)
      
      if (!lineups) {
        try {
          lineups = await apiFetch(`/fixtures/lineups?fixture=${fixtureId}`)
          cache.set(lineupsKey, lineups, 'fixtures')
          result.collected.lineups = true
        } catch (e) {
          result.errors.lineups = e.message
          lineups = { response: [] }
        }
      } else {
        result.cacheHits.lineups = true
      }
      result.lineups = lineups.response || []
    }

    // ────────────────────────────────────────────────────
    // PRIORIDADE 4: H2H + FORMA (cache longo)
    // ────────────────────────────────────────────────────
    // Esses dados vêm em paralelo - não são críticos para decisão imediata
    const secondaryPromises = []

    // H2H
    const h2hKey = `h2h:${fixtureId}`
    let h2h = cache.get(h2hKey)
    if (!h2h) {
      secondaryPromises.push(
        apiFetch(`/fixtures/headtohead?fixture=${fixtureId}&last=10`)
          .then(data => {
            cache.set(h2hKey, data, 'h2h')
            result.collected.h2h = true
            return data
          })
          .catch(e => {
            result.errors.h2h = e.message
            return { response: [] }
          })
      )
    } else {
      result.cacheHits.h2h = true
      secondaryPromises.push(Promise.resolve(h2h))
    }

    // Prediction
    const predKey = `prediction:${fixtureId}`
    let prediction = cache.get(predKey)
    if (!prediction) {
      secondaryPromises.push(
        apiFetch(`/predictions?fixture=${fixtureId}`)
          .then(data => {
            cache.set(predKey, data, 'prediction')
            result.collected.prediction = true
            return data
          })
          .catch(e => {
            result.errors.prediction = e.message
            return { response: [] }
          })
      )
    } else {
      result.cacheHits.prediction = true
      secondaryPromises.push(Promise.resolve(prediction))
    }

    // Aguarda dados secundários
    const [h2hData, predData] = await Promise.all(secondaryPromises)
    result.h2h = h2hData.response || []
    result.prediction = predData.response?.[0] || null

    // ────────────────────────────────────────────────────
    // PRIORIDADE 5: INJURIES (cache muito longo)
    // ────────────────────────────────────────────────────
    const injuriesKey = `injuries:${fixtureId}`
    let injuries = cache.get(injuriesKey)
    
    if (!injuries) {
      try {
        injuries = await apiFetch(`/injuries?fixture=${fixtureId}`)
        cache.set(injuriesKey, injuries, 'injuries')
        result.collected.injuries = true
      } catch (e) {
        result.errors.injuries = e.message
        injuries = { response: [] }
      }
    } else {
      result.cacheHits.injuries = true
    }
    result.injuries = injuries.response || []

    res.json(result)

  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack })
  }
})

// ══════════════════════════════════════════════════════
// ENDPOINTS ORIGINAIS (mantidos para compatibilidade)
// ══════════════════════════════════════════════════════

// Partidas ao vivo
app.get('/api/live', async (req, res) => {
  const cacheKey = 'live:all'
  let data = cache.get(cacheKey)
  if (!data) {
    try {
      data = await apiFetch('/fixtures?live=all')
      cache.set(cacheKey, data, 'fixtures')
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }
  res.json(data)
})

// Pré-jogo
app.get('/api/fixtures', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0]
    const league = req.query.league ? `&league=${req.query.league}` : ''
    const cacheKey = `fixtures:${date}:${league}`
    
    let data = cache.get(cacheKey)
    if (!data) {
      data = await apiFetch(`/fixtures?date=${date}${league}`)
      cache.set(cacheKey, data, 'fixtures')
    }
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Stats
app.get('/api/stats/:id', async (req, res) => {
  const cacheKey = `stats:${req.params.id}`
  let data = cache.get(cacheKey)
  if (!data) {
    try {
      data = await apiFetch(`/fixtures/statistics?fixture=${req.params.id}`)
      cache.set(cacheKey, data, 'liveStats')
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }
  res.json(data)
})

// Odds
app.get('/api/odds/:id', async (req, res) => {
  const cacheKey = `odds:${req.params.id}`
  let data = cache.get(cacheKey)
  if (!data) {
    try {
      data = await apiFetch(`/fixtures/odds?fixture=${req.params.id}&bookmaker=6`)
      cache.set(cacheKey, data, 'odds')
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }
  res.json(data)
})

// Lineups
app.get('/api/lineups/:id', async (req, res) => {
  const cacheKey = `lineups:${req.params.id}`
  let data = cache.get(cacheKey)
  if (!data) {
    try {
      data = await apiFetch(`/fixtures/lineups?fixture=${req.params.id}`)
      cache.set(cacheKey, data, 'fixtures')
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }
  res.json(data)
})

// Events
app.get('/api/events/:id', async (req, res) => {
  const cacheKey = `events:${req.params.id}`
  let data = cache.get(cacheKey)
  if (!data) {
    try {
      data = await apiFetch(`/fixtures/events?fixture=${req.params.id}`)
      cache.set(cacheKey, data, 'liveStats')
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }
  res.json(data)
})

// H2H
app.get('/api/h2h/:h2hIds', async (req, res) => {
  const cacheKey = `h2h:${req.params.h2hIds}`
  let data = cache.get(cacheKey)
  if (!data) {
    try {
      data = await apiFetch(`/fixtures/headtohead?h2h=${req.params.h2hIds}&last=10`)
      cache.set(cacheKey, data, 'h2h')
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }
  res.json(data)
})

// Form
app.get('/api/form/:teamId', async (req, res) => {
  try {
    const league = req.query.league || ''
    const season = req.query.season || new Date().getFullYear()
    const last = req.query.last || 10
    const leagueParam = league ? `&league=${league}` : ''
    const cacheKey = `form:${req.params.teamId}:${season}:${league}`
    
    let data = cache.get(cacheKey)
    if (!data) {
      data = await apiFetch(`/fixtures?team=${req.params.teamId}&last=${last}&season=${season}${leagueParam}`)
      cache.set(cacheKey, data, 'form')
    }
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Injuries
app.get('/api/injuries/:id', async (req, res) => {
  const cacheKey = `injuries:${req.params.id}`
  let data = cache.get(cacheKey)
  if (!data) {
    try {
      data = await apiFetch(`/injuries?fixture=${req.params.id}`)
      cache.set(cacheKey, data, 'injuries')
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }
  res.json(data)
})

// Standings
app.get('/api/standings', async (req, res) => {
  try {
    const league = req.query.league || '71'
    const season = req.query.season || new Date().getFullYear()
    const cacheKey = `standings:${league}:${season}`
    
    let data = cache.get(cacheKey)
    if (!data) {
      data = await apiFetch(`/standings?league=${league}&season=${season}`)
      cache.set(cacheKey, data, 'standings')
    }
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Prediction
app.get('/api/prediction/:id', async (req, res) => {
  const cacheKey = `prediction:${req.params.id}`
  let data = cache.get(cacheKey)
  if (!data) {
    try {
      data = await apiFetch(`/predictions?fixture=${req.params.id}`)
      cache.set(cacheKey, data, 'prediction')
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }
  res.json(data)
})

// Busca times
app.get('/api/teams/search', async (req, res) => {
  try {
    const query = req.query.q || ''
    if (query.length < 3) {
      return res.json({ response: [] })
    }
    const cacheKey = `teams:${query.toLowerCase()}`
    let data = cache.get(cacheKey)
    if (!data) {
      data = await apiFetch(`/teams?search=${encodeURIComponent(query)}`)
      cache.set(cacheKey, data, 'fixtures')
    }
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Fixtures de um time
app.get('/api/team/:teamId/fixtures', async (req, res) => {
  try {
    const teamId = req.params.teamId
    const season = req.query.season || new Date().getFullYear()
    const cacheKey = `team:${teamId}:${season}`
    
    let data = cache.get(cacheKey)
    if (!data) {
      data = await apiFetch(`/fixtures?team=${teamId}&season=${season}&last=15`)
      cache.set(cacheKey, data, 'fixtures')
    }
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ══════════════════════════════════════════════════════
// ADMIN & MONITORING
// ══════════════════════════════════════════════════════

// Health check com stats de cache
app.get('/api/health', (req, res) => {
  const cacheStats = cache.stats()
  res.json({
    status: 'ok',
    keyConfigured: !!API_KEY,
    endpoints: 15,
    cache: cacheStats,
    uptime: process.uptime()
  })
})

// Clear cache (admin)
app.post('/api/admin/cache/clear', (req, res) => {
  const { pattern } = req.body
  cache.clear(pattern)
  res.json({ success: true, cleared: pattern || 'all' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`✅ Trading Backend rodando na porta ${PORT}`)
  console.log(`🔑 API Key: ${API_KEY ? 'configurada' : 'NÃO configurada'}`)
  console.log(`📡 Endpoints: 15 (incluindo /api/trading/collect)`)
  console.log(`💾 Cache inteligente: ativado`)
  console.log(`⚡ Coleta priorizada: ativada`)
})
