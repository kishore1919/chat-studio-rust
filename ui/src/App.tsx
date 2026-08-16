import { lazy, Suspense, useEffect, useState } from 'react'
import { Chat } from './routes/Chat'
import { useSettingsStore } from './store/settings'
import { Toaster } from '@/components/ui/sonner'
import { StreamErrorWatcher } from '@/components/StreamErrorWatcher'

// Settings pulls in Select/Dialog/DropdownMenu/Switch and its own panes -
// none of that is needed for first paint, so it's split into its own chunk
// rather than bloating the bundle the Chat view has to parse on startup.
const Settings = lazy(() => import('./routes/Settings').then((m) => ({ default: m.Settings })))

type Route = 'chat' | 'settings'

export default function App() {
  const [route, setRoute] = useState<Route>('chat')
  const load = useSettingsStore((s) => s.load)
  const prefetchEnabledProviderModels = useSettingsStore((s) => s.prefetchEnabledProviderModels)

  useEffect(() => {
    load().then(prefetchEnabledProviderModels)
  }, [load, prefetchEnabledProviderModels])

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <StreamErrorWatcher />
      <Toaster position="bottom-center" />
      {route === 'chat' ? (
        <Chat onOpenSettings={() => setRoute('settings')} />
      ) : (
        <Suspense fallback={null}>
          <Settings onBack={() => setRoute('chat')} />
        </Suspense>
      )}
    </div>
  )
}
