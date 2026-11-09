// Yala Maha phone IVR. Asterisk answers pbx.im calls and hands each one to this FastAGI server.
//   key 1 (or no key) -> latest water level for the caller's tank or reservoir, found by caller ID
//   key 2             -> talk to the Yala Maha assistant: Gemini hears the recording, Gemini TTS answers
const net = require('net')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Pool } = require('pg')
const { GoogleGenAI } = require('@google/genai')

const SOUNDS = process.env.SOUNDS_DIR || '/sounds'             // the same volume is sounds/ivr inside Asterisk
const AST_SOUNDS = '/var/lib/asterisk/sounds/ivr'
// Flash-Lite: cheapest with a published price ($0.30 in / $2.50 out per 1M), 500 free requests a day
const CHAT_MODELS = [...new Set([process.env.IVR_CHAT_MODEL || 'gemini-3.5-flash-lite', 'gemini-3.5-flash'])]
// Cheapest first. Each model has its own quota, so the next takes over when one is used up.
const TTS_MODELS = [...new Set([process.env.IVR_TTS_MODEL || 'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts', 'gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview'])]
const VOICE = process.env.GEMINI_VOICE || 'Kore'
const THRESHOLD = Number(process.env.ALERT_THRESHOLD) || 90
const MAX_TURNS = 5                                                // questions per call
const MAX_AI_CALLS = Number(process.env.MAX_AI_CALLS) || 3         // callers talking to Gemini at once
const AI_CALLS_PER_HOUR = 4                                        // per phone number, protects the API quota

// --- Multi-Key Pool & Failover Management for Phone IVR ---
const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || ''
const API_KEYS = rawKeys
  .split(/[,;\n\s]+/)
  .map((k) => k.trim())
  .filter((k) => k.length > 5)

if (API_KEYS.length === 0) {
  console.warn('[IVR] WARNING: No GEMINI_API_KEY or GEMINI_API_KEYS configured.')
} else {
  console.log(`[IVR KeyPool] Loaded ${API_KEYS.length} Gemini API key(s) with auto-failover & rotation.`)
}

let currentKeyIndex = 0

function getAIClient(forcedIndex = null) {
  if (API_KEYS.length === 0) return { client: new GoogleGenAI({ apiKey: 'missing' }), keyIndex: 0, keyMasked: 'none' }
  const idx = forcedIndex !== null ? forcedIndex % API_KEYS.length : currentKeyIndex % API_KEYS.length
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length
  const key = API_KEYS[idx]
  return {
    client: new GoogleGenAI({ apiKey: key }),
    keyIndex: idx,
    keyMasked: key.slice(0, 6) + '...' + key.slice(-4),
  }
}

const RETRYABLE = /\b(429|500|503|504|404)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|NOT_FOUND|overloaded|high demand|timed? ?out|abort/i

async function withKeyFailover(operation) {
  const totalKeys = Math.max(1, API_KEYS.length)
  let lastError = null

  for (let attempt = 0; attempt < totalKeys; attempt++) {
    const { client, keyIndex: kIdx, keyMasked } = getAIClient()
    try {
      return await operation(client)
    } catch (err) {
      lastError = err
      const isRateOrTransient = RETRYABLE.test(err.message)
      console.warn(`[IVR KeyPool] Key ${kIdx + 1}/${totalKeys} (${keyMasked}) error: ${err.message.slice(0, 120)}`)
      if (isRateOrTransient && attempt < totalKeys - 1) {
        console.log(`[IVR KeyPool] Rate limit/busy. Auto-switching to next API key for caller...`)
        continue
      }
      if (!isRateOrTransient) break
    }
  }
  throw lastError
}
const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 4
})

// First thing every caller hears; each line in its own language
const LANG_MENU = 'ශ්‍රී ලංකාවේ ප්‍රමුඛතම කෘත්‍රිම බුද්ධි සහායක සේවාව වන යල මහ වෙත ඔබව සාදරයෙන් පිළිගනිමු. Thank you for calling Yala Maha, Sri Lanka’s premier AI assistant service. සිංහල සඳහා එක ඔබන්න. தமிழுக்கு இரண்டை அழுத்தவும். For English, press three.'
const LANGS = { 1: 'si', 2: 'ta', 3: 'en' }
const LANG_NAME = { si: 'Sinhala', ta: 'Tamil', en: 'English' }

const SAY = {
  si: {
    menu: 'ආයුබෝවන්, මේ යාල මහ. ඔබේ ජලාශයේ ජල මට්ටම දැනගැනීමට එක ඔබන්න. සහායකයාගෙන් ප්‍රශ්නයක් ඇසීමට දෙක ඔබන්න.',
    afterAlert: 'සහායකයාගෙන් ප්‍රශ්නයක් ඇසීමට දෙක ඔබන්න.',
    ask: 'බීප් හඬෙන් පසු ඔබේ ප්‍රශ්නය අසන්න.',
    askMore: 'තවත් ප්‍රශ්නයක් ඇත්නම් බීප් හඬෙන් පසු අසන්න.',
    notHeard: 'සමාවන්න, මට ඇසුණේ නැහැ.',
    busy: 'සමාවන්න, සහායකයා දැන් කාර්යබහුලයි. පසුව නැවත අමතන්න.',
    bye: 'ස්තූතියි. ආයුබෝවන්.'
  },
  ta: {
    menu: 'வணக்கம், இது யால மஹா. உங்கள் நீர்த்தேக்கத்தின் நீர் மட்டத்தை அறிய ஒன்றை அழுத்தவும். உதவியாளரிடம் கேள்வி கேட்க இரண்டை அழுத்தவும்.',
    afterAlert: 'உதவியாளரிடம் கேள்வி கேட்க இரண்டை அழுத்தவும்.',
    ask: 'பீப் ஒலிக்குப் பிறகு உங்கள் கேள்வியைக் கேளுங்கள்.',
    askMore: 'வேறு கேள்வி இருந்தால் பீப் ஒலிக்குப் பிறகு கேளுங்கள்.',
    notHeard: 'மன்னிக்கவும், எனக்குக் கேட்கவில்லை.',
    busy: 'மன்னிக்கவும், உதவியாளர் இப்போது பிஸியாக இருக்கிறார். பின்னர் மீண்டும் அழைக்கவும்.',
    bye: 'நன்றி. வணக்கம்.'
  },
  en: {
    menu: 'Welcome to Yala Maha. To hear your reservoir water level, press one. To ask the assistant a question, press two.',
    afterAlert: 'To ask the assistant a question, press two.',
    ask: 'Ask your question after the beep.',
    askMore: 'If you have another question, ask it after the beep.',
    notHeard: 'Sorry, I did not hear that.',
    busy: 'Sorry, the assistant is busy right now. Please call again later.',
    bye: 'Thank you. Goodbye.'
  }
}

const ALERT = {
  si: {
    level: (n, p) => `${n} ජලාශය සියයට ${p} ක් පිරී ඇත.`,
    spilling: ' වාන් දමමින් පවතී.',
    danger: ' පහළ ප්‍රදේශවල සිටින අය අවදානමෙන් සූදානම්ව සිටින්න.',
    unregistered: 'ඔබේ අංකය යාල මහ හි ලියාපදිංචි කර නැත. ',
    allClear: 'දැනට කිසිදු ජලාශයක් අවදානම් මට්ටමක නැත.',
    high: 'ඉහළ ජල මට්ටම්: '
  },
  ta: {
    level: (n, p) => `${n} நீர்த்தேக்கம் ${p} சதவீதம் நிரம்பியுள்ளது.`,
    spilling: ' வான் பாய்கிறது.',
    danger: ' தாழ்வான பகுதிகளில் உள்ளவர்கள் எச்சரிக்கையாக இருக்கவும்.',
    unregistered: 'உங்கள் எண் யால மஹாவில் பதிவு செய்யப்படவில்லை. ',
    allClear: 'தற்போது எந்த நீர்த்தேக்கமும் அபாய நிலையில் இல்லை.',
    high: 'அதிக நீர் மட்டங்கள்: '
  },
  en: {
    level: (n, p) => `${n} is ${p} percent full.`,
    spilling: ' It is spilling.',
    danger: ' People in low areas downstream should be ready.',
    unregistered: 'Your number is not registered with Yala Maha. ',
    allClear: 'No reservoir is at a dangerous level right now.',
    high: 'High water levels: '
  }
}

const SYSTEM = `You are the Yala Maha assistant answering a phone call from a Sri Lankan farmer.
Help with paddy cultivation, Yala/Maha seasons, reservoir levels, flood alerts and farmer registration.
The caller's audio is attached. Reply in the caller's language (Sinhala, Tamil or English).
This is spoken aloud on a phone: at most three short sentences, no lists or symbols, write numbers as words.
Return JSON: heard = what the caller said, reply = your answer, done = true if the caller is saying goodbye or has no more questions.
If the audio is silent or unclear, set heard to "" and politely ask them to repeat.`

// ---------- water levels ----------

async function lookupCaller(digits) {
  if (digits.length < 9) return null
  const { rows } = await db.query(
    `SELECT f.full_name, t.tank_name, wl.storage_percentage AS tank_pct,
            r.name AS res_name, rl.usable_storage_percent AS res_pct, rl.is_spilling
       FROM farmers f
       LEFT JOIN mahawelitanks t ON t.id = f.tank_id
       LEFT JOIN LATERAL (SELECT storage_percentage FROM mahaweli_water_level
                           WHERE tank_id = f.tank_id ORDER BY reading_date DESC LIMIT 1) wl ON true
       LEFT JOIN reservoirs r ON r.id = f.reservoir_id
       LEFT JOIN LATERAL (SELECT usable_storage_percent, is_spilling FROM reservoir_levels
                           WHERE reservoir_id = f.reservoir_id ORDER BY reading_date DESC LIMIT 1) rl ON true
      WHERE right(regexp_replace(f.phone, '\\D', '', 'g'), 9) = $1 AND f.is_active
      LIMIT 1`,
    [digits.slice(-9)]
  )
  return rows[0] || null
}

async function highTanks() {
  const { rows } = await db.query(
    `SELECT t.tank_name, wl.storage_percentage AS pct
       FROM mahawelitanks t
       JOIN LATERAL (SELECT storage_percentage FROM mahaweli_water_level
                      WHERE tank_id = t.id ORDER BY reading_date DESC LIMIT 1) wl ON true
      WHERE wl.storage_percentage >= $1
      ORDER BY wl.storage_percentage DESC LIMIT 3`,
    [THRESHOLD]
  )
  return rows
}

function levelLine(lang, name, pct, spilling) {
  const a = ALERT[lang], p = Math.round(Number(pct))
  let s = a.level(name, p)
  if (/yes|spill/i.test(spilling || '')) s += a.spilling
  if (p >= THRESHOLD) s += a.danger
  return s
}

async function alertText(farmer, lang) {
  const a = ALERT[lang]
  if (farmer?.tank_name && farmer.tank_pct != null) return levelLine(lang, farmer.tank_name, farmer.tank_pct)
  if (farmer?.res_name && farmer.res_pct != null) return levelLine(lang, farmer.res_name, farmer.res_pct, farmer.is_spilling)
  const high = await highTanks()
  const intro = farmer ? '' : a.unregistered
  if (!high.length) return intro + a.allClear
  return intro + a.high + high.map((t) => levelLine(lang, t.tank_name, t.pct)).join(' ')
}

// ---------- audio ----------

function wavHeader(bytes, rate) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + bytes, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(bytes, 40)
  return h
}

// 16-bit mono PCM out of a WAV file
function readWav(buf) {
  let rate = 24000
  for (let i = 12; i + 8 <= buf.length;) {
    const id = buf.toString('ascii', i, i + 4), size = buf.readUInt32LE(i + 4)
    if (id === 'fmt ') rate = buf.readUInt32LE(i + 12)
    if (id === 'data') return { pcm: buf.subarray(i + 8, i + 8 + size), rate }
    i += 8 + size + (size & 1)
  }
  throw new Error('no data chunk in WAV')
}

// Phone audio is 8 kHz: average each window of samples down to one (also filters out the highs)
function to8kWav(pcm, rate) {
  const n = pcm.length >> 1, ratio = rate / 8000, len = Math.floor(n / ratio)
  const out = Buffer.alloc(len * 2)
  for (let i = 0; i < len; i++) {
    const a = Math.floor(i * ratio), b = Math.min(n, Math.max(a + 1, Math.floor((i + 1) * ratio)))
    let s = 0
    for (let j = a; j < b; j++) s += pcm.readInt16LE(j * 2)
    out.writeInt16LE(Math.round(s / (b - a)), i * 2)
  }
  return Buffer.concat([wavHeader(out.length, 8000), out])
}

// v3: audio without "Read this aloud" prefix; fresh hash remakes any old cached speech
const ttsId = (text) => 'tts-' + crypto.createHash('sha1').update('v3|' + VOICE + '|' + text).digest('hex').slice(0, 16)
const isCached = (text) => fs.existsSync(path.join(SOUNDS, ttsId(text) + '.wav'))

// Text -> 8 kHz WAV in the shared folder; returns the name Asterisk plays it by
async function tts(text) {
  const id = ttsId(text), file = path.join(SOUNDS, id + '.wav')
  if (!fs.existsSync(file)) {
    const audioInfo = await withKeyFailover(async (ai) => {
      let a, last
      for (const model of TTS_MODELS) {
        try {
          const r = await ai.models.generateContent({
            model,
            contents: [{ parts: [{ text }] }],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
              httpOptions: { timeout: 45000 }
            }
          })
          a = r.candidates?.[0]?.content?.parts?.[0]?.inlineData
          if (a?.data) break
          last = new Error('no audio returned')
        } catch (e) {
          last = e
          console.warn(`tts: ${model} failed: ${String(e.message).slice(0, 120)}`)
          if (!RETRYABLE.test(e.message)) throw e
        }
      }
      if (!a?.data) throw last
      let pcm = Buffer.from(a.data, 'base64')
      let rate = Number(/rate=(\d+)/.exec(a.mimeType || '')?.[1]) || 24000
      if (/wav/i.test(a.mimeType || '')) ({ pcm, rate } = readWav(pcm))
      return { pcm, rate }
    })
    fs.writeFileSync(file + '.part', to8kWav(audioInfo.pcm, audioInfo.rate))
    fs.renameSync(file + '.part', file)
  }
  return AST_SOUNDS + '/' + id
}

async function askGemini(recording, history, context, lang) {
  const audio = { inlineData: { mimeType: 'audio/wav', data: fs.readFileSync(recording).toString('base64') } }
  return await withKeyFailover(async (ai) => {
    let last
    for (const model of CHAT_MODELS) {
      try {
        const r = await ai.models.generateContent({
          model,
          contents: [...history, { role: 'user', parts: [audio] }],
          config: {
            systemInstruction: `${SYSTEM}\nThe caller chose ${LANG_NAME[lang]}; answer in it unless they speak another language.\nCaller's water level right now: ${context}`,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: { heard: { type: 'STRING' }, reply: { type: 'STRING' }, done: { type: 'BOOLEAN' } },
              required: ['heard', 'reply', 'done']
            },
            httpOptions: { timeout: 25000 }
          }
        })
        const ans = JSON.parse(r.text)
        if (!ans.reply) throw new Error('empty reply')
        history.push({ role: 'user', parts: [{ text: ans.heard || '(unclear)' }] }, { role: 'model', parts: [{ text: ans.reply }] })
        return ans
      } catch (e) {
        last = e
        console.warn(`chat: ${model} failed: ${e.message}`)
        if (!RETRYABLE.test(e.message)) throw e
      }
    }
    throw last
  })
}

// ---------- AGI protocol ----------

class Hangup extends Error {}

function agiSession(sock) {
  const lines = []
  let buf = '', wake = null, closed = false
  sock.setEncoding('utf8')
  sock.on('data', (d) => {
    buf += d
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) lines.push(buf.slice(0, i).replace(/\r$/, ''))
    wake?.()
  })
  sock.on('close', () => { closed = true; wake?.() })
  sock.on('error', () => {})

  async function line() {
    while (!lines.length) {
      if (closed) throw new Hangup()
      await new Promise((r) => (wake = r))
      wake = null
    }
    return lines.shift()
  }

  async function cmd(c) {
    if (closed) throw new Hangup()
    sock.write(c + '\n')
    for (;;) {
      const l = await line()
      if (l === 'HANGUP') continue                       // FastAGI hangup notice; the next reply says -1
      if (l.startsWith('520-')) {                        // usage dump, ends with "520 End of proper usage."
        while (!(await line()).startsWith('520 ')) {}
        throw new Error(`AGI rejected: ${c}`)
      }
      const m = /^(\d{3}) (.*)$/.exec(l)
      if (!m) continue
      if (m[1] === '511') throw new Hangup()
      if (m[1] !== '200') throw new Error(`AGI ${c}: ${l}`)
      const result = /result=(\S*)/.exec(m[2])?.[1] ?? ''
      if (result === '-1') throw new Hangup()
      return { result, data: /\((.*)\)/.exec(m[2])?.[1] }
    }
  }

  async function vars() {
    const v = {}
    for (let l; (l = await line()) !== '';) {
      const i = l.indexOf(':')
      if (i > 0) v[l.slice(0, i)] = l.slice(i + 1).trim()
    }
    return v
  }

  return { cmd, vars, close: () => sock.end() }
}

// ---------- the call ----------

let aiCalls = 0
const aiUse = new Map() // phone -> timestamps of assistant sessions in the last hour

function allowAssistant(phone) {
  const now = Date.now()
  const recent = (aiUse.get(phone) || []).filter((t) => now - t < 3600e3)
  if (aiCalls >= MAX_AI_CALLS || recent.length >= AI_CALLS_PER_HOUR) return false
  aiUse.set(phone, [...recent, now])
  return true
}

async function handleCall(agi, v) {
  const phone = (v.agi_callerid || '').replace(/\D/g, '')
  const uid = (v.agi_uniqueid || Date.now().toString()).replace(/\W/g, '')
  let holding = false
  const hold = async (on) => {
    if (on === holding) return
    holding = on
    await agi.cmd(`EXEC ${on ? 'StartMusicOnHold' : 'StopMusicOnHold'} ""`)
  }
  // Play text; music covers the few seconds the speech takes to make
  const say = async (text) => {
    if (!isCached(text)) await hold(true)
    const name = await tts(text)
    await hold(false)
    await agi.cmd(`STREAM FILE ${name} ""`)
  }
  const menu = async (text, ms) => {
    const name = await tts(text)
    return (await agi.cmd(`GET DATA ${name} ${ms} 1`)).result
  }

  console.log(`call ${uid} from ${phone || 'unknown'}`)
  await agi.cmd('ANSWER')
  const farmerP = lookupCaller(phone).catch((e) => (console.error('lookup:', e.message), null))

  // Language first. A language whose prompts aren't made yet (TTS quota) falls back to Sinhala.
  let lang = 'si'
  if (isCached(LANG_MENU)) {
    let k = ''
    for (let i = 0; i < 2 && !LANGS[k]; i++) k = await menu(LANG_MENU, 5000)
    lang = LANGS[k] || 'si'
  }
  if (!ready(lang)) lang = 'si'
  const S = SAY[lang]
  console.log(`  ${uid} language: ${lang}`)

  let key = ''
  for (let i = 0; i < 2 && !key; i++) key = await menu(S.menu, 6000)

  const context = await alertText(await farmerP, lang).catch((e) => (console.error('alert:', e.message), 'unknown'))

  if (key !== '2') {
    if (context === 'unknown') await say(S.busy)
    else await say(context)
    key = await menu(S.afterAlert, 5000)
  }
  if (key === '2') {
    if (!allowAssistant(phone)) await say(S.busy)
    else {
      aiCalls++
      try { await assistant(agi, say, hold, uid, context, lang) } finally { aiCalls-- }
    }
  }
  await say(S.bye)
  await agi.cmd('HANGUP')
}

async function assistant(agi, say, hold, uid, context, lang) {
  const S = SAY[lang], history = []
  let silent = 0
  for (let turn = 0; turn < MAX_TURNS && silent < 2; turn++) {
    await say(turn ? S.askMore : S.ask)
    const rec = `rec-${uid}-${turn}`, file = path.join(SOUNDS, rec + '.wav')
    // up to 15 s, stops after 3 s of silence or on #
    await agi.cmd(`RECORD FILE ${AST_SOUNDS}/${rec} wav "#" 15000 0 BEEP s=3`)
    if (!fs.existsSync(file) || fs.statSync(file).size < 8000) { // under half a second
      silent++
      await say(S.notHeard)
      continue
    }
    silent = 0
    await hold(true)
    let ans
    try {
      ans = await askGemini(file, history, context, lang)
    } finally {
      fs.rm(file, () => {})
    }
    console.log(`  ${uid} heard: ${ans.heard}\n  ${uid} reply: ${ans.reply}`)
    const name = await tts(ans.reply)
    await hold(false)
    await agi.cmd(`STREAM FILE ${name} ""`)
    fs.rm(path.join(SOUNDS, path.basename(name) + '.wav'), () => {}) // replies are one-off
    if (ans.done) break
  }
}

// ---------- server ----------

net.createServer(async (sock) => {
  const agi = agiSession(sock)
  try {
    await handleCall(agi, await agi.vars())
  } catch (e) {
    if (!(e instanceof Hangup)) {
      console.error('call failed:', e.message)
      try {
        await agi.cmd(`EXEC StopMusicOnHold ""`)
        await agi.cmd(`STREAM FILE ${await tts(SAY.si.busy)} ""`)
      } catch {}
    }
  } finally {
    agi.close()
  }
}).listen(Number(process.env.AGI_PORT) || 4573, () => console.log(`IVR FastAGI on :${Number(process.env.AGI_PORT) || 4573}`))

// Make the fixed prompts ahead so the first caller doesn't wait; drop day-old audio (alerts change daily)
// Sinhala first: it is the fallback for everything
const ALL_PROMPTS = [...Object.values(SAY.si), LANG_MENU, ...Object.values(SAY.ta), ...Object.values(SAY.en)]
const PROMPTS = new Set(ALL_PROMPTS.map((t) => ttsId(t) + '.wav'))
const ready = (lang) => Object.values(SAY[lang]).every(isCached)
async function warm() {
  const missing = ALL_PROMPTS.filter((t) => !isCached(t))
  for (const text of missing) await tts(text).catch(() => {})
  const left = ALL_PROMPTS.filter((t) => !isCached(t)).length
  if (left) { console.warn(`warm: ${left} prompts left, retrying in a minute`); setTimeout(warm, 60e3).unref() }
  else if (missing.length) console.log('warm: all prompts ready')
}
function prune() {
  for (const f of fs.readdirSync(SOUNDS)) {
    const p = path.join(SOUNDS, f)
    if (!PROMPTS.has(f) && Date.now() - fs.statSync(p).mtimeMs > 24 * 3600e3) fs.rmSync(p, { force: true })
  }
}
fs.mkdirSync(SOUNDS, { recursive: true })
prune()
warm()
setInterval(prune, 3600e3).unref()
