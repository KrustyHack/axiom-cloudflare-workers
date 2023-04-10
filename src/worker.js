const axiomDataset = 'my-dataset' // Your Axiom dataset
const axiomToken = 'xapt-xxx' // Your Axiom API token

// 8< ----------- snip ------------
const Version = '0.1.0'
const axiomEndpoint = 'https://api.axiom.co'
let workerTimestamp
let batch = []

const generateId = length => {
  let text = ''
  const possible = 'abcdefghijklmnpqrstuvwxyz0123456789'
  for (let i = 0; i < length; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

const WORKER_ID = generateId(6)

const throttle = (fn, wait, maxCalls) => {
  let lastFn
  let lastTime
  let callCount = 0
  return function actual (...args) {
    const context = this
    callCount += 1

    // First call, set lastTime
    if (lastTime == null) {
      lastTime = Date.now()
    }

    clearTimeout(lastFn)
    if (callCount >= maxCalls) {
      fn.apply(context, args)
      callCount = 0
      lastTime = Date.now()
    } else {
      lastFn = setTimeout(() => {
        if (Date.now() - lastTime >= wait) {
          fn.apply(context, args)
          lastTime = Date.now()
        }
      }, Math.max(wait - (Date.now() - lastTime), 0))
    }
  }
}

async function sendLogs () {
  if (batch.length === 0) {
    return
  }
  const logs = batch
  batch = []

  const url = `${axiomEndpoint}/v1/datasets/${axiomDataset}/ingest`
  return fetch(url, {
    method: 'POST',
    body: logs.map(JSON.stringify).join('\n'),
    keepalive: true,
    headers: {
      'Content-Type': 'application/x-ndjson',
      Authorization: `Bearer ${axiomToken}`,
      'User-Agent': 'axiom-cloudflare/' + Version
    }
  })
}

// This will send logs every second or every 1000 logs
const throttledSendLogs = throttle(sendLogs, 1000, 1000)

async function handleRequest (request, context) {
  const start = Date.now()

  const response = await fetch(request)
  const duration = Date.now() - start

  const cf = {}
  if (request.cf) {
    // delete does not work so we copy into a new object
    Object.keys(request.cf).forEach(key => {
      if (key !== 'tlsClientAuth' && key !== 'tlsExportedAuthenticator') {
        cf[key] = request.cf[key]
      }
    })
  }

  batch.push({
    _time: Date.now(),
    request: {
      url: request.url,
      headers: request.headers,
      method: request.method,
      ...cf
    },
    response: {
      duration,
      headers: response.headers,
      status: response.status
    },
    worker: {
      version: Version,
      id: WORKER_ID,
      started: workerTimestamp
    }
  })

  return response
}

export default {
  fetch (req, _, context) {
    context.passThroughOnException()

    if (!workerTimestamp) {
      workerTimestamp = new Date().toISOString()
    }

    context.waitUntil(throttledSendLogs())
    return handleRequest(req, context)
  }
}
