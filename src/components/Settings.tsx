import Icon from './Icon';
import type { ThemePref } from '../hooks/useTheme';
import type { Settings } from '../types';

export interface SettingsProps {
  themePref: ThemePref;
  onThemeChange: (p: ThemePref) => void;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

const THEMES: Array<{ id: ThemePref; label: string; icon: string; hint: string }> = [
  { id: 'light', label: 'Light', icon: 'sun', hint: 'Always light' },
  { id: 'dark', label: 'Dark', icon: 'moon', hint: 'Always dark' },
  { id: 'system', label: 'System', icon: 'monitor', hint: 'Match Windows' },
];

export default function Settings({ themePref, onThemeChange, settings, onSettingsChange }: SettingsProps) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onSettingsChange({ ...settings, [key]: value });

  return (
    <div className="p-4 md:p-6 space-y-4 rise-in max-w-[840px]">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Settings</h1>
        <p className="text-[12.5px] text-ink-2 mt-0.5">Appearance, startup behavior and safety controls</p>
      </div>

      {/* Appearance */}
      <Section icon="palette" title="Appearance" desc="Choose how MacroFlow looks">
        <div className="grid grid-cols-3 gap-2.5">
          {THEMES.map((t) => {
            const active = themePref === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onThemeChange(t.id)}
                className={`rounded-xl border p-3 text-center transition-all ${
                  active ? 'border-brand bg-brand/[0.07] ring-2 ring-brand/25' : 'border-line bg-elevated hover:border-brand/40'
                }`}
              >
                <span className={`w-9 h-9 mx-auto rounded-lg grid place-items-center ${active ? 'bg-brand text-brand-fg' : 'bg-surface border border-line text-ink-2'}`}>
                  <Icon name={t.icon} size={17} />
                </span>
                <div className="text-[12px] font-semibold text-ink mt-2">{t.label}</div>
                <div className="text-[10.5px] text-ink-3">{t.hint}</div>
              </button>
            );
          })}
        </div>
      </Section>

      {/* General */}
      <Section icon="sliders" title="General" desc="How the app runs on Windows">
        <Toggle
          label="Start with Windows"
          desc="Launch automatically at sign-in (adds a Startup registry entry, no admin needed)"
          checked={settings.startWithWindows}
          onChange={(v) => set('startWithWindows', v)}
        />
        <Toggle
          label="Minimize to system tray"
          desc="Keep running in the background when the window is closed"
          checked={settings.minimizeToTray}
          onChange={(v) => set('minimizeToTray', v)}
        />
        <Toggle
          label="Start minimized"
          desc="Open straight to the tray without showing the window"
          checked={settings.startMinimized}
          onChange={(v) => set('startMinimized', v)}
        />
        <Toggle
          label="Show notifications"
          desc="Display a toast when a flow finishes or fails"
          checked={settings.notificationsEnabled}
          onChange={(v) => set('notificationsEnabled', v)}
        />
      </Section>

      {/* Safety */}
      <Section icon="shield" title="Safety" desc="Emergency stop for running automations">
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-ink">Emergency kill switch</div>
            <div className="text-[11px] text-ink-2 mt-0.5">Global shortcut that instantly aborts every running macro</div>
          </div>
          <kbd className="text-[11.5px] font-mono font-bold bg-danger/10 text-danger border border-danger/25 px-2.5 py-1.5 rounded-lg shrink-0">
            {settings.killSwitch}
          </kbd>
        </div>
      </Section>

      {/* About */}
      <Section icon="info" title="About" desc="">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand to-brand-strong grid place-items-center text-brand-fg shadow">
            <Icon name="nodes" size={20} />
          </div>
          <div>
            <div className="text-[13px] font-bold text-ink">MacroFlow <span className="text-ink-3 font-normal">v1.4.2</span></div>
            <div className="text-[11.5px] text-ink-2">Visual automation launcher for Windows 10 &amp; 11</div>
          </div>
          <div className="ml-auto flex gap-2">
            <a
              href="https://github.com/jaimitus/MacroFlow"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-[11.5px] font-semibold bg-elevated border border-line text-ink px-3 py-1.5 rounded-lg hover:border-brand/40 transition-colors"
            >
              <Icon name="github" size={14} /> GitHub
            </a>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({ icon, title, desc, children }: { icon: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-xl border border-line shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2.5">
        <span className="w-7 h-7 rounded-lg bg-brand/12 text-brand grid place-items-center"><Icon name={icon} size={15} /></span>
        <div>
          <h3 className="text-[13px] font-bold text-ink leading-tight">{title}</h3>
          {desc && <p className="text-[11px] text-ink-3 leading-tight">{desc}</p>}
        </div>
      </div>
      <div className="p-4 divide-y divide-line">{children}</div>
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-ink">{label}</div>
        <div className="text-[11px] text-ink-2 mt-0.5">{desc}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-[24px] rounded-full transition-colors shrink-0 ${checked ? 'bg-brand' : 'bg-ink/15'}`}
      >
        <span className={`absolute top-[2px] w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-[2px]'}`} />
      </button>
    </div>
  );
}
