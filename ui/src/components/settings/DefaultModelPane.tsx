import { useSettingsStore } from '../../store/settings'
import { ProviderIcon } from '../../lib/providerIcon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function DefaultModelPane() {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)
  const modelsByProvider = useSettingsStore((s) => s.modelsByProvider)

  if (!settings) return null
  const enabledProviders = settings.providers.filter((p) => p.enabled)

  return (
    <div className="max-w-md space-y-3">
      <h2 className="text-base font-semibold text-foreground">Default Model</h2>
      <div>
        <Label className="mb-1 block text-xs text-muted-foreground">Provider</Label>
        <Select
          value={settings.default_provider ?? ''}
          onValueChange={(value) => save({ ...settings, default_provider: value })}
        >
          <SelectTrigger className="w-full text-xs">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            {enabledProviders.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="flex items-center gap-1.5">
                  <ProviderIcon dialect={p.dialect} className="size-3.5" />
                  {p.display_name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="mb-1 block text-xs text-muted-foreground">Model</Label>
        <Input
          value={settings.default_model ?? ''}
          onChange={(e) => save({ ...settings, default_model: e.target.value })}
          list="default-model-suggestions"
          placeholder="Type a model id, e.g. gpt-4o-mini"
          className="text-xs font-mono"
        />
        <datalist id="default-model-suggestions">
          {(modelsByProvider[settings.default_provider ?? ''] ?? []).map((m) => (
            <option key={m.id} value={m.id} />
          ))}
        </datalist>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Type the model id directly, or pick from suggestions loaded from the provider.
        </p>
      </div>
    </div>
  )
}
