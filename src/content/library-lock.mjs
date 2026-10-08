// 확장 reload·업데이트로 연결이 끊긴 직후에는 chrome.runtime.id가 아직 남아 있어 잠시 뒤 판정한다.
const INVALIDATION_GRACE_MS = 100

/** 무효화된 컨텍스트의 연결 끊김을 기존 확장 컨텍스트 무효화 처리로 넘긴다. */
export function settleRuntimeDisconnect(runtime, failure) {
  return new Promise(resolve => setTimeout(() => {
    let valid = false
    try { valid = Boolean(runtime.id) } catch { /* 무효화된 컨텍스트다. */ }
    resolve(valid ? failure : new Error('Extension context invalidated.'))
  }, INVALIDATION_GRACE_MS))
}

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
        const fail = failure => {
          if (failure?.message !== 'ML_LIBRARY_LOCK_DISCONNECTED') reject(failure)
          else void settleRuntimeDisconnect(runtime, failure).then(reject)
        }
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
          if (!started) fail(error())
        }
        port.onDisconnect.addListener(disconnect)
        port.onMessage.addListener(message => {
          if (message?.action !== 'granted' || started || disconnected) return
          started = true
          Promise.resolve().then(() => { check(); return action({ check }) }).then(value => {
            check()
            resolve(value)
          }).catch(fail).finally(close)
        })
        try { port.postMessage({ action: 'acquire' }) } catch { disconnect() }
      })
    }
  }
}
