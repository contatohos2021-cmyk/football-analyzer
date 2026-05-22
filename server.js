import express from 'express'
import cors from 'cors'

const app = express()

// CORS aberto
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}))

app.use(express.json())

const API_KEY = process.env.API_FOOTBALL_KEY || ''
const PORT = process.env.PORT || 3001

console.log('🚀 Iniciando backend...')
console.log('🔑 API Key:', API_KEY ? 'Configurada ✅' : 'NÃO configurada ❌')

// Cache simples
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

// API Fetch com proteção
async function apiFetch(path) {
  try {
    const url = `https://v3.football.api-sports.io${path}`
    console.log('📡 Request:', url)
    
    const res = await fetch(url, {
      headers: {
        'x-apisports-key': API_KEY,
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': 'v3.football.api-sports.io'
      }
    })
    
    if (!res.ok) {
      console.error('❌ API Error:', res.status)
      return { response: [], errors: [`API returned ${res.status}`] }
    }
    
    const data = await res.json()
    console.log('✅ Response OK')
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
    uptime: process.uptime()
  })
})

// ══════════════════════════════════════════════════════
// PARTIDAS AO VIVO
// ══════════════════════════════════════════════════════
app.get('/api/live', async (req, res) => {
  try {
    const cacheKey = 'live:all'
    let data = getCache(cacheKey)
    
    if (!data) {
      console.log('🔄 Buscando partidas ao vivo...')
      data = await apiFetch('/fixtures?live=all')
      setCache(cacheKey, data, 30000) // 30s
    } else {
      console.log('💾 Cache hit: live')
    }
    
    res.json(data)
  } catch (error) {
    console.error('Error /api/live:', error)
    res.status(500).json({ error: error.message })
  }
})

// ══════════════════════════════════════════════════════
// PARTIDAS DE HOJE
// ══════════════════════════════════════════════════════
app.get('/api/fixtures', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0]
    const cacheKey = `fixtures:${date}`
    let data = getCache(cacheKey)
    
    if (!data) {
      console.log('🔄 Buscando partidas de:', date)
      data = await apiFetch(`/fixtures?date=${date}`)
      setCache(cacheKey, data, 60000) // 1min
    } else {
      console.log('💾 Cache hit: fixtures')
    }
    
    res.json(data)
  } catch (error) {
    console.error('Error /api/fixtures:', error)
    res.status(500).json({ error: error.message })
  }
})

// ══════════════════════════════════════════════════════
// COLETA PRIORIZADA
// ══════════════════════════════════════════════════════
app.post('/api/trading/collect', async (req, res) => {
  try {
    const { fixtureId, isLive } = req.body
    
    if (!fixtureId) {
      return res.status(400).json({ error: 'fixtureId required' })
    }
    
    console.log('🎯 Coletando dados para fixture:', fixtureId)
    
    const result = {
      fixtureId,
      timestamp: new Date().toISOString(),
      collected: {},
      cacheHits: {},
      errors: {}
    }
    
    // Odds (prioridade 1)
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
    
    // Stats (se ao vivo)
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
      
      // Events
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
    
    // H2H (background)
    const h2hKey = `h2h:${fixtureId}`
    let h2h = getCache(h2hKey)
    if (!h2h) {
      h2h = await apiFetch(`/fixtures/headtohead?fixture=${fixtureId}&last=5`)
      setCache(h2hKey, h2h, 3600000) // 1h
      result.collected.h2h = true
    } else {
      result.cacheHits.h2h = true
    }
    result.h2h = h2h.response || []
    
    // Prediction
    const predKey = `prediction:${fixtureId}`
    let prediction = getCache(predKey)
    if (!prediction) {
      prediction = await apiFetch(`/predictions?fixture=${fixtureId}`)
      setCache(predKey, prediction, 86400000) // 24h
      result.collected.prediction = true
    } else {
      result.cacheHits.prediction = true
    }
    result.prediction = prediction.response?.[0] || null
    
    console.log('✅ Coleta completa')
    res.json(result)
    
  } catch (error) {
    console.error('Error /api/trading/collect:', error)
    res.status(500).json({ error: error.message, stack: error.stack })
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
// CATCH ALL ERRORS
// ══════════════════════════════════════════════════════
app.use((error, req, res, next) => {
  console.error('💥 Unhandled error:', error)
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  })
})

// ══════════════════════════════════════════════════════
// START SERVER
// ══════════════════════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ Backend rodando')
  console.log(`📡 Porta: ${PORT}`)
  console.log(`🔑 API Key: ${API_KEY ? 'OK' : 'FALTA'}`)
  console.log(`🌐 Endpoints: 6`)
  console.log('💾 Cache: Ativo')
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 Shutting down gracefully...')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('👋 Shutting down...')
  process.exit(0)
})

// Catch uncaught errors
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection:', reason)
  process.exit(1)
})
