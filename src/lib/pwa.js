// 앱으로 설치(PWA): 서비스 워커 등록과 새 판 알림.
// 서비스 워커 자체는 scripts/sw.js (빌드 때 dist/sw.js 로 나감). 개발 서버에서는 등록하지 않음.

const listeners = new Set()
let updateReady = false

// 새 판이 깔려 이 창을 맡게 되면 알림. 예전부터 서비스 워커가 맡던 창에서만(처음 설치 때는 안 띄움)
export function onUpdateReady(fn) {
  listeners.add(fn)
  if (updateReady) fn()
  return () => listeners.delete(fn)
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || updateReady) return
    updateReady = true
    listeners.forEach((fn) => fn())
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => {
        // 앱을 오래 켜 두어도 새 배포를 알아채도록 1시간마다, 그리고 창으로 돌아올 때 확인
        const check = () => reg.update().catch(() => {})
        setInterval(check, 60 * 60 * 1000)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check()
        })
      })
      .catch(() => {})
  })
}
