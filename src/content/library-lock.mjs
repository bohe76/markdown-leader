export function createLibraryLock(runtime) {
  return {
    request(name, action) {
      return new Promise((resolve, reject) => {
        const port = runtime.connect({ name })
        let started = false
        let closed = false
        let disconnected = false
        const error = () => new Error('ML_LIBRARY_LOCK_DISCONNECTED')
        const check = () => { if (disconnected) throw error() }
        const heartbeat = setInterval(() => {
          try { port.postMessage({ action: 'heartbeat' }) } catch { disconnect() }
        }, 20000)
        function close() {
          closed = true
          clearInterval(heartbeat)
          try { port.postMessage({ action: 'release' }); port.disconnect() } catch { /* 이미 종료된 포트다. */ }
        }
        function disconnect() {
          void runtime.lastError
          if (closed) return
          disconnected = true
          clearInterval(heartbeat)
          if (!started) reject(error())
        }
        port.onDisconnect.addListener(disconnect)
        port.onMessage.addListener(message => {
          if (message?.action !== 'granted' || started || disconnected) return
          started = true
          Promise.resolve().then(() => { check(); return action({ check }) }).then(value => {
            check()
            resolve(value)
          }).catch(reject).finally(close)
        })
        try { port.postMessage({ action: 'acquire' }) } catch { disconnect() }
      })
    }
  }
}
