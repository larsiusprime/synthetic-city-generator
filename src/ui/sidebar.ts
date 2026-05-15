import { CITIES, findCity, parseLatLon, type City } from './cities';

export interface GenerateParams {
  seed: number;
  anchor: { lat: number; lon: number };
  anchorLabel: string;
  includeRiver: boolean;
}

export interface SidebarHandlers {
  onGenerate: (params: GenerateParams) => Promise<void> | void;
  onExport: () => Promise<void> | void;
}

export class Sidebar {
  private readonly root: HTMLElement;
  private readonly handlers: SidebarHandlers;

  private anchorInput!: HTMLInputElement;
  private seedInput!: HTMLInputElement;
  private riverInput!: HTMLInputElement;
  private generateBtn!: HTMLButtonElement;
  private exportBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;

  constructor(root: HTMLElement, handlers: SidebarHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.mount();
  }

  private mount(): void {
    this.root.innerHTML = `
      <form id="gen-form" novalidate>
        <div class="field">
          <label for="anchor-input">Anchor</label>
          <input
            type="text"
            id="anchor-input"
            name="anchor"
            list="cities-list"
            placeholder="city or lat,lon"
            autocomplete="off"
            required
          />
          <datalist id="cities-list">
            ${CITIES.map(
              (c: City) =>
                `<option value="${escapeHtml(c.name)}, ${escapeHtml(c.country)}"></option>`,
            ).join('')}
          </datalist>
          <p class="hint">Pick from the list or type "lat,lon" (e.g. 39.1, -94.6)</p>
        </div>

        <div class="field">
          <label for="seed-input">Seed</label>
          <div class="row">
            <input type="number" id="seed-input" name="seed" min="0" max="4294967295" step="1" required />
            <button type="button" id="seed-random">Randomize</button>
          </div>
        </div>

        <div class="field">
          <label class="check">
            <input type="checkbox" id="river-toggle" name="river" checked />
            <span>Include river</span>
          </label>
        </div>

        <div class="actions">
          <button type="submit" id="generate-btn">Generate</button>
          <button type="button" id="export-btn" disabled>Export &hellip;</button>
        </div>

        <p id="gen-status" role="status" aria-live="polite">Idle.</p>
      </form>
    `;

    this.anchorInput = this.q<HTMLInputElement>('#anchor-input');
    this.seedInput = this.q<HTMLInputElement>('#seed-input');
    this.riverInput = this.q<HTMLInputElement>('#river-toggle');
    this.generateBtn = this.q<HTMLButtonElement>('#generate-btn');
    this.exportBtn = this.q<HTMLButtonElement>('#export-btn');
    this.statusEl = this.q<HTMLElement>('#gen-status');

    this.anchorInput.value = 'Kansas City, US';
    this.seedInput.value = String(randomSeed());

    this.q<HTMLButtonElement>('#seed-random').addEventListener('click', () => {
      this.seedInput.value = String(randomSeed());
    });

    this.q<HTMLFormElement>('#gen-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      void this.submit();
    });

    this.exportBtn.addEventListener('click', () => {
      void this.handlers.onExport();
    });
  }

  private q<T extends Element>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`sidebar: missing element ${selector}`);
    return el;
  }

  private async submit(): Promise<void> {
    const anchor = this.parseAnchor();
    if (!anchor) {
      this.setStatus('Invalid anchor. Pick a city or type "lat,lon".', 'error');
      this.anchorInput.focus();
      return;
    }
    const seed = Number(this.seedInput.value);
    if (!Number.isFinite(seed) || seed < 0) {
      this.setStatus('Invalid seed.', 'error');
      this.seedInput.focus();
      return;
    }

    this.setBusy(true);
    this.setStatus('Generating…', 'busy');
    try {
      await this.handlers.onGenerate({
        seed: seed >>> 0,
        anchor: anchor.coord,
        anchorLabel: anchor.label,
        includeRiver: this.riverInput.checked,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus(`Error: ${msg}`, 'error');
    } finally {
      this.setBusy(false);
    }
  }

  private parseAnchor(): { coord: { lat: number; lon: number }; label: string } | null {
    const raw = this.anchorInput.value.trim();
    if (!raw) return null;
    const city = findCity(raw);
    if (city) {
      return { coord: { lat: city.lat, lon: city.lon }, label: `${city.name}, ${city.country}` };
    }
    const ll = parseLatLon(raw);
    if (ll) return { coord: ll, label: `${ll.lat.toFixed(4)}, ${ll.lon.toFixed(4)}` };
    return null;
  }

  setStatus(msg: string, kind: 'idle' | 'busy' | 'ok' | 'error' = 'idle'): void {
    this.statusEl.textContent = msg;
    this.statusEl.dataset.kind = kind;
  }

  setBusy(busy: boolean): void {
    this.generateBtn.disabled = busy;
    this.exportBtn.disabled = busy || this.exportBtn.dataset.ready !== 'true';
    this.root.setAttribute('aria-busy', String(busy));
  }

  setExportReady(ready: boolean): void {
    this.exportBtn.dataset.ready = String(ready);
    this.exportBtn.disabled = !ready;
  }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
