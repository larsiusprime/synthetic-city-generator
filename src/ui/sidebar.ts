import type { WaterKind } from '../core/terrain';
import { CITIES, findCity, parseLatLon, type City } from './cities';

export interface GenerateParams {
  seed: number;
  anchor: { lat: number; lon: number };
  anchorLabel: string;
  water: WaterKind;
}

export type OverlayKind = 'grid' | 'downtown' | 'townsite' | 'streets' | 'blocks';

export interface SidebarHandlers {
  onGenerate: (params: GenerateParams) => Promise<void> | void;
  onExport: () => Promise<void> | void;
  onToggleOverlay: (kind: OverlayKind, visible: boolean) => void;
}

export class Sidebar {
  private readonly root: HTMLElement;
  private readonly handlers: SidebarHandlers;

  private anchorInput!: HTMLInputElement;
  private seedInput!: HTMLInputElement;
  private waterSelect!: HTMLSelectElement;
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
          <label for="water-select">Water</label>
          <select id="water-select" name="water">
            <option value="none">No water</option>
            <option value="river" selected>Include river</option>
            <option value="shore">Include shore</option>
          </select>
        </div>

        <div class="actions">
          <button type="submit" id="generate-btn">Generate</button>
          <button type="button" id="export-btn" disabled>Export &hellip;</button>
        </div>

        <fieldset class="overlays">
          <legend>Overlays</legend>
          <label class="check">
            <input type="checkbox" id="overlay-grid" checked />
            <span>Ghost grid (PLS sections)</span>
          </label>
          <label class="check">
            <input type="checkbox" id="overlay-downtown" checked />
            <span>Downtown anchor</span>
          </label>
          <label class="check">
            <input type="checkbox" id="overlay-townsite" checked />
            <span>Townsite (¼ section)</span>
          </label>
          <label class="check">
            <input type="checkbox" id="overlay-blocks" checked />
            <span>Blocks</span>
          </label>
          <label class="check">
            <input type="checkbox" id="overlay-streets" checked />
            <span>Streets</span>
          </label>
        </fieldset>

        <p id="gen-status" role="status" aria-live="polite">Idle.</p>
      </form>
    `;

    this.anchorInput = this.q<HTMLInputElement>('#anchor-input');
    this.seedInput = this.q<HTMLInputElement>('#seed-input');
    this.waterSelect = this.q<HTMLSelectElement>('#water-select');
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

    this.q<HTMLInputElement>('#overlay-grid').addEventListener('change', (ev) => {
      this.handlers.onToggleOverlay('grid', (ev.target as HTMLInputElement).checked);
    });
    this.q<HTMLInputElement>('#overlay-downtown').addEventListener('change', (ev) => {
      this.handlers.onToggleOverlay('downtown', (ev.target as HTMLInputElement).checked);
    });
    this.q<HTMLInputElement>('#overlay-townsite').addEventListener('change', (ev) => {
      this.handlers.onToggleOverlay('townsite', (ev.target as HTMLInputElement).checked);
    });
    this.q<HTMLInputElement>('#overlay-streets').addEventListener('change', (ev) => {
      this.handlers.onToggleOverlay('streets', (ev.target as HTMLInputElement).checked);
    });
    this.q<HTMLInputElement>('#overlay-blocks').addEventListener('change', (ev) => {
      this.handlers.onToggleOverlay('blocks', (ev.target as HTMLInputElement).checked);
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
        water: this.waterSelect.value as WaterKind,
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
