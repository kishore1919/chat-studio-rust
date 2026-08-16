import { useEffect, useState } from 'react'
import { Chat } from './routes/Chat'
import { Settings } from './routes/Settings'
import { useSettingsStore } from './store/settings'

type Route = 'chat' | 'settings'

export default function App() {
  const [route, setRoute] = useState<Route>('chat')
  const load = useSettingsStore((s) => s.load)

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      {route === 'chat' ? (
        <Chat onOpenSettings={() => setRoute('settings')} />
      ) : (
        <Settings onBack={() => setRoute('chat')} />
      )}
    </div>
  )
}
