import express from 'express'
import cors from 'cors'

const app = express()

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}))

app.use(express.json())

const API_KEY = process.env.API_FOOTBALL_KEY || ''
const PORT = process.env.PORT || 3001

console.log('🚀 Football Trading Backend - Professional Edition')
console.log('🔑 API Key:', API_KEY ? 'Configurada ✅' : 'NÃO configurada ❌')

// CACHE
const cache = new Map()

function setCache(key, value, ttl = 60000) {
  cache.set(key, { value, expires: Date.now() + ttl })
}

function getCache(key) {
  const item = cache.get(key)
  if (!item || Date.now() > item.expires) {
    cache.delete(key)
    return null
  }
  return item.value
}

// API FETCH
async function apiFetch(path) {
  try {
    const url = `https://v3.football.api-sports.io${path}`
    console.log('📡', url)
    
    const res = await fetch(url, {
      headers: {
        'x-apisports-key': API_KEY,
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': 'v3.football.api-sports.io'
      }
    })
    
    if (!res.ok) {
      console.error('❌ API Error:', res.status)
      return { response: [], errors: [`API error ${res.status}`] }
    }
    
    const data = await res.json()
    console.log('✅ OK')
    return data
    
  } catch (error) {
    console.error('❌ Fetch Error:', error.message)
    return { response: [], errors: [error.message] }
  }
}

// ══════════════════════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    keyConfigured: !!API_KEY,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    endpoints: [
      '/api/live',
      '/api/fixtures',
      '/api/trading/collect',
      '/api/stats/:id',
      '/api/form/:teamId',
      '/api/h2h/:team1/:team2',
      '/api/injuries/:teamId'
    ]
  })
})

// ══════════════════════════════════════════════════════
// PARTIDAS AO VIVO
// ══════════════════════════════════════════════════════
app.get('/api/live', async (req, res) => {
  try {
    const key = 'live:all'
    let data = getCache(key)
    
    if (!data) {
      console.log('🔄 Live matches')
      data = await apiFetch('/fixtures?live=all')
      setCache(key, data, 30000)
    }
    
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ══════════════════════════════════════════════════════
// PARTIDAS DE HOJE
// ══════════════════════════════════════════════════════
app.get('/api/fixtures', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0]
    const key = `fixtures:${date}`
    let data = getCache(key)
    
    if (!data) {
      console.log('🔄 Fixtures:', date)
      data = await apiFetch(`/fixtures?date=${date}`)
      setCache(key, data, 60000)
    }
    
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ══════════════════════════════════════════════════════
// FORMA DO TIME (últimos jogos casa/fora)
// ══════════════════════════════════════════════════════
app.get('/api/form/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params
    const { league, season, last = 5, venue } = req.query
    
    // venue: home, away, ou nenhum (todos)
    let path = `/fixtures?team=${teamId}&season=${season || new Date().getFullYear()}&last=${last}`
    if (league) path += `&league=${league}`
    if (venue) path += `&venue=${venue}`
    
    const key = `form:${teamId}:${venue || 'all'}:${season}`
    let data = getCache(key)
    
    if (!data) {
      console.log('🔄 Team form:', teamId, venue)
      data = await apiFetch(path)
      setCache(key, data, 3600000) // 1h
    }
    
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ══════════════════════════════════════════════════════
// H2H (Head to Head)
// ══════════════════════════════════════════════════════
app.get('/api/h2h/:team1/:team2', async (req, res) => {
  try {
    const { team1, team2 } = req.params
    const { last = 5 } = req.query
    
    const key = `h2h:${team1}:${team2}`
    let data = getCache(key)
    
    if (!data) {
      console.log('🔄 H2H:', team1, 'vs', team2)
      data = await apiFetch(`/fixtures/headtohead?h2h=${team1}-${team2}&last=${last}`)
      setCache(key, data, 3600000) // 1h
    }
    
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ══════════════════════════════════════════════════════
// INJURIES/SIDELINED (Lesões e Desfalques)
// ══════════════════════════════════════════════════════
app.get('/api/injuries/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params
    const key = `injuries:${teamId}`
    let data = getCache(key)
    
    if (!data) {
      console.log('🔄 Injuries:', teamId)
      data = await apiFetch(`/injuries?team=${teamId}`)
      setCache(key, data, 7200000) // 2h
    }
    
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ══════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════
app.get('/api/stats/:id', async (req, res) => {
  try {
    const key = `stats:${req.params.id}`
    let data = getCache(key)
    
    if (!data) {
      data = await apiFetch(`/fixtures/statistics?fixture=${req.params.id}`)
      setCache(key, data, 45000)
    }
    
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ══════════════════════════════════════════════════════
// COLETA COMPLETA PRIORIZADA
// ══════════════════════════════════════════════════════
app.post('/api/trading/collect', async (req, res) => {
  try {
    const { fixtureId, isLive } = req.body
    
    if (!fixtureId) {
      return res.status(400).json({ error: 'fixtureId required' })
    }
    
    console.log('🎯 COLETA COMPLETA:', fixtureId)
    
    const result = {
      fixtureId,
      timestamp: new Date().toISOString(),
      collected: {},
      cacheHits: {},
      errors: {}
    }
    
    // 1. FIXTURE INFO
    const fixtureKey = `fixture:${fixtureId}`
    let fixture = getCache(fixtureKey)
    if (!fixture) {
      fixture = await apiFetch(`/fixtures?id=${fixtureId}`)
      setCache(fixtureKey, fixture, 60000)
      result.collected.fixture = true
    } else {
      result.cacheHits.fixture = true
    }
    result.fixture = fixture.response?.[0] || null
    
    // 2. ODDS
    const oddsKey = `odds:${fixtureId}`
    let odds = getCache(oddsKey)
    if (!odds) {
      odds = await apiFetch(`/odds?fixture=${fixtureId}&bookmaker=6`)
      setCache(oddsKey, odds, 30000)
      result.collected.odds = true
    } else {
      result.cacheHits.odds = true
    }
    result.odds = odds.response?.[0] || null
    
    // 3. STATS (se ao vivo)
    if (isLive) {
      const statsKey = `stats:${fixtureId}`
      let stats = getCache(statsKey)
      if (!stats) {
        stats = await apiFetch(`/fixtures/statistics?fixture=${fixtureId}`)
        setCache(statsKey, stats, 45000)
        result.collected.stats = true
      } else {
        result.cacheHits.stats = true
      }
      result.stats = stats.response || []
      
      // EVENTS
      const eventsKey = `events:${fixtureId}`
      let events = getCache(eventsKey)
      if (!events) {
        events = await apiFetch(`/fixtures/events?fixture=${fixtureId}`)
        setCache(eventsKey, events, 45000)
        result.collected.events = true
      } else {
        result.cacheHits.events = true
      }
      result.events = events.response || []
    }
    
    // 4. H2H
    if (result.fixture) {
      const homeId = result.fixture.teams.home.id
      const awayId = result.fixture.teams.away.id
      
      const h2hKey = `h2h:${homeId}:${awayId}`
      let h2h = getCache(h2hKey)
      if (!h2h) {
        h2h = await apiFetch(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=5`)
        setCache(h2hKey, h2h, 3600000)
        result.collected.h2h = true
      } else {
        result.cacheHits.h2h = true
      }
      result.h2h = h2h.response || []
    }
    
    // 5. PREDICTION
    const predKey = `prediction:${fixtureId}`
    let prediction = getCache(predKey)
    if (!prediction) {
      prediction = await apiFetch(`/predictions?fixture=${fixtureId}`)
      setCache(predKey, prediction, 86400000)
      result.collected.prediction = true
    } else {
      result.cacheHits.prediction = true
    }
    result.prediction = prediction.response?.[0] || null
    
    console.log('✅ Coleta completa')
    res.json(result)
    
  } catch (error) {
    console.error('Error:', error)
    res.status(500).json({ error: error.message, stack: error.stack })
  }
})

// ERROR HANDLER
app.use((error, req, res, next) => {
  console.error('💥 Error:', error)
  res.status(500).json({ error: error.message })
})

// START
app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ Backend rodando')
  console.log(`📡 Porta: ${PORT}`)
  console.log(`🔑 API Key: ${API_KEY ? 'OK' : 'FALTA'}`)
  console.log(`🌐 Endpoints: 8`)
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught:', error)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled:', reason)
  process.exit(1)
})
