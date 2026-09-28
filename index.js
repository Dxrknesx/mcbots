const mineflayer = require('mineflayer')
const fs = require('fs')
const path = require('path')

const configPath = path.join(__dirname, process.argv[2] || 'config.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const bots = new Map()

function log(name, msg) {
  console.log(`[${new Date().toLocaleTimeString()}] [${name}] ${msg}`)
}

// Kick-Gruende kommen je nach Version als String, JSON-String oder NBT-Objekt
function reasonText(reason) {
  if (typeof reason === 'string') {
    try { reason = JSON.parse(reason) } catch { return reason }
  }
  const flat = (c) => {
    if (c == null) return ''
    if (typeof c === 'string') return c
    if (c.value !== undefined && c.type) return flat(c.value) // NBT
    return (c.text || c.translate || '') + (Array.isArray(c.extra) ? c.extra.map(flat).join('') : '')
  }
  return flat(reason) || JSON.stringify(reason)
}

// Humanize: zufaellige Reconnect-Zeit zwischen min und max, damit es nicht nach Bot aussieht
function reconnectDelay() {
  const h = config.humanize
  if (!h?.enabled) return config.reconnectDelayMs || 10000
  const min = h.reconnectMinMs ?? 5 * 60 * 1000
  const max = h.reconnectMaxMs ?? 10 * 60 * 1000
  return Math.floor(min + Math.random() * (max - min))
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

function startBot(acc) {
  const name = acc.username
  const opts = {
    host: config.host,
    port: config.port || 25565,
    username: acc.username,
    auth: 'microsoft',
    profilesFolder: path.join(__dirname, 'auth-cache', acc.username),
    hideErrors: false,
    // Erster Login pro Account: Link + Code im Log, danach kommt der Token aus auth-cache
    onMsaCode: (data) => log(name, `Microsoft-Login: ${data.verification_uri} oeffnen und Code ${data.user_code} eingeben`)
  }
  if (config.version) opts.version = config.version

  const bot = mineflayer.createBot(opts)
  bots.set(name, bot)
  let antiAfk = null
  let spawnTimeout = null
  const timers = []
  let stopped = false
  let firstSpawn = true
  let statusTimer = null

  // ---- Debug: Verbindungsablauf sichtbar machen ("debug": true in config.json) ----
  if (config.debug) {
    const client = bot._client
    const seenPlay = new Set()
    let packetCount = 0
    let lastPacket = '-'

    client.on('connect', () => log(name, `[debug] TCP-Verbindung zu ${opts.host}:${opts.port} steht`))
    client.on('session', (s) => log(name, `[debug] Microsoft-Auth ok, Ingame-Name: ${s?.selectedProfile?.name}`))
    client.on('state', (n, o) => log(name, `[debug] Protokoll-Phase: ${o} -> ${n}`))

    // Eingehende Pakete: Login/Configuration komplett, in Play jedes Paket nur beim ersten Mal
    client.on('packet', (data, meta) => {
      packetCount++
      lastPacket = `${meta.state}/${meta.name}`
      if (meta.state !== 'play') log(name, `[debug] <- ${lastPacket}`)
      else if (config.debugPackets && !seenPlay.has(meta.name)) {
        seenPlay.add(meta.name)
        log(name, `[debug] <- ${lastPacket} (erstes Mal)`)
      }
      if (/disconnect/.test(meta.name)) log(name, `[debug] Disconnect-Paket: ${reasonText(data.reason)}`)

      // Ressourcenpaket in der Configuration-Phase (Proxy/Server-Pack) - ohne Antwort haengt der Bot dort fest
      if (meta.state === 'configuration' && meta.name === 'add_resource_pack') {
        log(name, `[debug] Server verlangt Ressourcenpaket (${data.url}) - bestaetige`)
        try {
          client.write('resource_pack_receive', { uuid: data.uuid, result: 3 }) // accepted
          client.write('resource_pack_receive', { uuid: data.uuid, result: 0 }) // successfully loaded
        } catch (err) { log(name, `[debug] Ressourcenpaket-Antwort fehlgeschlagen: ${err.message}`) }
      }
    })

    // Ausgehende Pakete ausserhalb von Play loggen
    const write = client.write.bind(client)
    client.write = (packetName, params) => {
      if (client.state !== 'play') log(name, `[debug] -> ${client.state}/${packetName}`)
      return write(packetName, params)
    }

    statusTimer = setInterval(() => {
      const e = bot.entity
      log(name, `[status] Phase=${client.state} gespawnt=${!firstSpawn} Pakete=${packetCount}/${(config.statusIntervalMs || 30000) / 1000}s ` +
        `letztes=${lastPacket} Dimension=${bot.game?.dimension ?? '-'} Pos=${e ? e.position.floored() : '-'} ` +
        `Gamemode=${bot.game?.gameMode ?? '-'} Ping=${bot.player?.ping ?? '-'}ms`)
      packetCount = 0
    }, config.statusIntervalMs || 30000)
  }

  // Ressourcenpaket in der Play-Phase immer annehmen
  bot.on('resourcePack', (url) => {
    log(name, `Ressourcenpaket angefragt (${url}) - akzeptiere`)
    bot.acceptResourcePack()
  })
  bot.on('respawn', () => log(name, `Respawn/Dimensionswechsel -> ${bot.game?.dimension}`))
  bot.on('death', () => log(name, 'gestorben'))

  bot.once('login', () => {
    log(name, `eingeloggt als ${bot.username} (Protokoll-Version ${bot.version}, Dimension ${bot.game?.dimension}, Gamemode ${bot.game?.gameMode})`)
    spawnTimeout = setTimeout(() => {
      log(name, 'WARNUNG: 30s nach Login noch kein Spawn - Version passt vermutlich nicht (config "version" setzen, z.B. "1.21.4")')
    }, 30000)
  })

  bot.on('spawn', async () => {
    clearTimeout(spawnTimeout)
    if (!firstSpawn) { log(name, 'erneut gespawnt (Respawn/Serverwechsel)'); return }
    firstSpawn = false
    log(name, 'verbunden und gespawnt')

    // Erst warten bis die Welt geladen ist, sonst ignorieren viele Server/Plugins die Befehle
    try { await bot.waitForChunksToLoad() } catch {}

    // "joinCommands": ["/login pw", "/warp afk"] oder einzelnes "joinCommand"
    const cmds = [].concat(acc.joinCommands || acc.joinCommand || [])
    const delay = acc.joinCommandDelayMs ?? config.joinCommandDelayMs ?? 3000
    const step = config.commandIntervalMs || 2000
    cmds.forEach((cmd, i) => {
      timers.push(setTimeout(() => {
        if (bots.get(name) !== bot) return
        log(name, `sende: ${cmd}`)
        bot.chat(cmd)
      }, delay + i * step))
    })

    // Anti-AFK-Kick: kleine Kopfbewegung + Schwingen
    antiAfk = setInterval(() => {
      if (!bot.entity) return
      bot.look(bot.entity.yaw + (Math.random() - 0.5), bot.entity.pitch, true)
      bot.swingArm()
    }, config.antiAfkIntervalMs || 20000)
  })

  bot.on('messagestr', (m, position) => {
    if (config.logChat && position !== 'game_info' && m.trim()) log(name, `chat: ${m}`)
  })
  bot.on('kicked', (reason) => log(name, `gekickt: ${reasonText(reason)}`))
  bot.on('error', (err) => log(name, `Fehler: ${err.stack || err.message}`))

  bot.once('end', (reason) => {
    clearInterval(antiAfk)
    clearInterval(statusTimer)
    clearTimeout(spawnTimeout)
    timers.forEach(clearTimeout)
    bots.delete(name)
    log(name, `getrennt (${reason})`)
    if (config.reconnect && !stopped && !shuttingDown) {
      const delay = reconnectDelay()
      log(name, `Reconnect in ${formatDuration(delay)}${config.humanize?.enabled ? ' (humanize)' : ''}`)
      setTimeout(() => startBot(acc), delay)
    }
  })
}

let shuttingDown = false
process.on('SIGINT', () => {
  shuttingDown = true
  console.log('\nBeende alle Bots...')
  for (const b of bots.values()) b.quit()
  setTimeout(() => process.exit(0), 1000)
})

;(async () => {
  for (const acc of config.accounts) {
    startBot(acc)
    await sleep(config.joinDelayMs || 5000) // Join-Abstand, vermeidet Connection-Throttle
  }
})()
