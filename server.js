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

console.log('🚀 Football Trading Backend v2')
console.log('🔑 API Key:', API_KEY ? '✅' : '❌')

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

async function apiFetch(path) {
  try {
    const url = `https://v3.football.api-sports.io${path}`
    console.log('📡', path)
    
    const res = await fetch(url, {
      headers: {
        'x-apisports-key': API_KEY,
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': 'v3.football.api-sports.io'
      }
    })
    
    if (!res.ok) {
      console.error('❌', res.status, path)
      return { response: [], errors: [`API ${res.status}`] }
    }
    
    const data = await res.json()
    console.log('✅', path, '→', data.response?.length || 0, 'results')
    return data
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    return { response: [], errors: [error.message] }
  }
}

// HEALTH
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0',
    keyConfigured: !!API_KEY,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

// LIVE
app.get('/api/live', async (req, res) => {
  try {
    let data = getCache('live:all')
    if (!data) {
      data = await apiFetch('/fixtures?live=all')
      setCache('live:all', data, 30000)
    }
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// FIXTURES
app.get('/api/fixtures', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0]
    const key = `fixtures:${date}`
    let data = getCache(key)
    if (!data) {
      data = await apiFetch(`/fixtures?date=${date}`)
      setCache(key, data, 60000)
    }
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ════════════════════════════════════════════
// FORMA - SIMPLIFICADO (últimos N jogos)
// ════════════════════════════════════════════
app.get('/api/form/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params
    const { last = 10, venue } = req.query
    
    const key = `form:${teamId}:${last}:${venue || 'all'}`
    let data = getCache(key)
    
    if (!data) {
      // BUSCA SIMPLES: últimos jogos do time SEM filtros restritivos
      let path = `/fixtures?team=${teamId}&last=${last}`
      if (venue) path += `&venue=${venue}`
      
      data = await apiFetch(path)
      setCache(key, data, 3600000) // 1h
    }
    
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ════════════════════════════════════════════
// STATS DA TEMPORADA DO TIME
// ════════════════════════════════════════════
app.get('/api/team-stats/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params
    const { league, season } = req.query
    
    if (!league || !season) {
      return res.status(400).json({ error: 'league and season required' })
    }
    
    const key = `teamstats:${teamId}:${league}:${season}`
    let data = getCache(key)
    
    if (!data) {
      data = await apiFetch(`/teams/statistics?team=${teamId}&league=${league}&season=${season}`)
      setCache(key, data, 3600000) // 1h
    }
    
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// H2H
app.get('/api/h2h/:team1/:team2', async (req, res) => {
  try {
    const { team1, team2 } = req.params
    const { last = 10 } = req.query
    
    const key = `h2h:${team1}:${team2}`
    let data = getCache(key)
    
    if (!data) {
      data = await apiFetch(`/fixtures/headtohead?h2h=${team1}-${team2}&last=${last}`)
      setCache(key, data, 3600000)
    }
    
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// INJURIES
app.get('/api/injuries/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params
    const { season } = req.query
    
    const key = `injuries:${teamId}:${season || 'current'}`
    let data = getCache(key)
    
    if (!data) {
      let path = `/injuries?team=${teamId}`
      if (season) path += `&season=${season}`
      data = await apiFetch(path)
      setCache(key, data, 7200000)
    }
    
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// STATS DE FIXTURE
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

// ════════════════════════════════════════════
// COLETA COMPLETA - MELHORADA
// ════════════════════════════════════════════
app.post('/api/trading/collect', async (req, res) => {
  try {
    const { fixtureId, isLive } = req.body
    
    if (!fixtureId) {
      return res.status(400).json({ error: 'fixtureId required' })
    }
    
    console.log('🎯 COLETA:', fixtureId, isLive ? '(LIVE)' : '(PRE)')
    
    const result = {
      fixtureId,
      timestamp: new Date().toISOString(),
      collected: {},
      cacheHits: {}
    }
    
    // 1. FIXTURE
    const fixtureKey = `fixture:${fixtureId}`
    let fixture = getCache(fixtureKey)
    if (!fixture) {
      fixture = await apiFetch(`/fixtures?id=${fixtureId}`)
      setCache(fixtureKey, fixture, 60000)
      result.collected.fixture = true
    }
    result.fixture = fixture.response?.[0] || null
    
    if (!result.fixture) {
      return res.json(result)
    }
    
    const homeId = result.fixture.teams.home.id
    const awayId = result.fixture.teams.away.id
    const leagueId = result.fixture.league.id
    const season = result.fixture.league.season
    
    // 2. ODDS
    const oddsKey = `odds:${fixtureId}`
    let odds = getCache(oddsKey)
    if (!odds) {
      odds = await apiFetch(`/odds?fixture=${fixtureId}&bookmaker=6`)
      setCache(oddsKey, odds, 30000)
      result.collected.odds = true
    }
    result.odds = odds.response?.[0] || null
    
    // 3. STATS AO VIVO
    if (isLive) {
      const statsKey = `stats:${fixtureId}`
      let stats = getCache(statsKey)
      if (!stats) {
        stats = await apiFetch(`/fixtures/statistics?fixture=${fixtureId}`)
        setCache(statsKey, stats, 45000)
        result.collected.stats = true
      }
      result.stats = stats.response || []
      
      const eventsKey = `events:${fixtureId}`
      let events = getCache(eventsKey)
      if (!events) {
        events = await apiFetch(`/fixtures/events?fixture=${fixtureId}`)
        setCache(eventsKey, events, 45000)
        result.collected.events = true
      }
      result.events = events.response || []
    }
    
    // 4. H2H
    const h2hKey = `h2h:${homeId}:${awayId}`
    let h2h = getCache(h2hKey)
    if (!h2h) {
      h2h = await apiFetch(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=10`)
      setCache(h2hKey, h2h, 3600000)
      result.collected.h2h = true
    }
    result.h2h = h2h.response || []
    
    // 5. FORMA CASA (SEM filtro de liga)
    const homeFormKey = `form:${homeId}:10:home`
    let homeForm = getCache(homeFormKey)
    if (!homeForm) {
      homeForm = await apiFetch(`/fixtures?team=${homeId}&last=10&venue=home`)
      setCache(homeFormKey, homeForm, 3600000)
      result.collected.homeForm = true
    }
    result.homeForm = homeForm.response || []
    
    // 6. FORMA FORA (SEM filtro de liga)
    const awayFormKey = `form:${awayId}:10:away`
    let awayForm = getCache(awayFormKey)
    if (!awayForm) {
      awayForm = await apiFetch(`/fixtures?team=${awayId}&last=10&venue=away`)
      setCache(awayFormKey, awayForm, 3600000)
      result.collected.awayForm = true
    }
    result.awayForm = awayForm.response || []
    
    // 7. ÚLTIMOS JOGOS GERAIS (para backup)
    const homeLastKey = `last:${homeId}:5`
    let homeLast = getCache(homeLastKey)
    if (!homeLast) {
      homeLast = await apiFetch(`/fixtures?team=${homeId}&last=5`)
      setCache(homeLastKey, homeLast, 3600000)
      result.collected.homeLast = true
    }
    result.homeLast = homeLast.response || []
    
    const awayLastKey = `last:${awayId}:5`
    let awayLast = getCache(awayLastKey)
    if (!awayLast) {
      awayLast = await apiFetch(`/fixtures?team=${awayId}&last=5`)
      setCache(awayLastKey, awayLast, 3600000)
      result.collected.awayLast = true
    }
    result.awayLast = awayLast.response || []
    
    // 8. STATS DA TEMPORADA (médias, xG, etc.)
    const homeStatsKey = `teamstats:${homeId}:${leagueId}:${season}`
    let homeStats = getCache(homeStatsKey)
    if (!homeStats) {
      homeStats = await apiFetch(`/teams/statistics?team=${homeId}&league=${leagueId}&season=${season}`)
      setCache(homeStatsKey, homeStats, 3600000)
      result.collected.homeStats = true
    }
    result.homeTeamStats = homeStats.response || null
    
    const awayStatsKey = `teamstats:${awayId}:${leagueId}:${season}`
    let awayStats = getCache(awayStatsKey)
    if (!awayStats) {
      awayStats = await apiFetch(`/teams/statistics?team=${awayId}&league=${leagueId}&season=${season}`)
      setCache(awayStatsKey, awayStats, 3600000)
      result.collected.awayStats = true
    }
    result.awayTeamStats = awayStats.response || null
    
    // 9. LESÕES
    const homeInjKey = `injuries:${homeId}:${season}`
    let homeInj = getCache(homeInjKey)
    if (!homeInj) {
      homeInj = await apiFetch(`/injuries?team=${homeId}&season=${season}`)
      setCache(homeInjKey, homeInj, 7200000)
      result.collected.homeInjuries = true
    }
    result.homeInjuries = homeInj.response || []
    
    const awayInjKey = `injuries:${awayId}:${season}`
    let awayInj = getCache(awayInjKey)
    if (!awayInj) {
      awayInj = await apiFetch(`/injuries?team=${awayId}&season=${season}`)
      setCache(awayInjKey, awayInj, 7200000)
      result.collected.awayInjuries = true
    }
    result.awayInjuries = awayInj.response || []
    
    // 10. PREDICTION
    const predKey = `prediction:${fixtureId}`
    let prediction = getCache(predKey)
    if (!prediction) {
      prediction = await apiFetch(`/predictions?fixture=${fixtureId}`)
      setCache(predKey, prediction, 86400000)
      result.collected.prediction = true
    }
    result.prediction = prediction.response?.[0] || null
    
    console.log('✅ Coleta completa:', Object.keys(result.collected).length, 'requests')
    res.json(result)
    
  } catch (error) {
    console.error('Error:', error)
    res.status(500).json({ error: error.message })
  }
})

app.use((error, req, res, next) => {
  console.error('💥', error)
  res.status(500).json({ error: error.message })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ Rodando na porta', PORT)
})

process.on('uncaughtException', (e) => { console.error('💥', e); process.exit(1) })
process.on('unhandledRejection', (e) => { console.error('💥', e); process.exit(1) })
