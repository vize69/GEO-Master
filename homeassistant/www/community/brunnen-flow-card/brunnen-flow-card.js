(() => {
  'use strict';

  const CARD_TYPES = [
    'brunnen-flow-card',
    'vize-brunnen-flow-card-premium-v17',
    'vize-brunnen-flow-card-premium-v16',
  ];

  const DEFAULT_CONFIG = Object.freeze({
    title: 'Brunnen Flow',
    pump_entity: 'binary_sensor.brunnen_pumpe',
    flow_entity: 'sensor.brunnen_durchfluss',
    level_entity: 'sensor.brunnen_fuellstand',
    pressure_entity: 'sensor.brunnen_druck',
    status_entity: 'sensor.brunnen_status',
  });

  const UNAVAILABLE_STATES = new Set(['unknown', 'unavailable', undefined, null]);
  const ON_STATES = new Set(['on', 'open', 'running', 'active', 'true', '1']);
  const ERROR_STATES = new Set(['error', 'problem', 'fault', 'alarm', 'critical']);
  const WARNING_STATES = new Set(['warning', 'warn', 'low', 'dry', 'offline']);
  const ENTITY_KEYS = Object.freeze([
    'pump_entity',
    'flow_entity',
    'level_entity',
    'pressure_entity',
    'status_entity',
  ]);

  const css = `
    :host {
      --brunnen-card-bg: var(--ha-card-background, var(--card-background-color, #fff));
      --brunnen-primary-text: var(--primary-text-color, #212121);
      --brunnen-secondary-text: var(--secondary-text-color, #727272);
      --brunnen-accent: var(--accent-color, #03a9f4);
      --brunnen-water: var(--info-color, #2196f3);
      --brunnen-ok: var(--success-color, #4caf50);
      --brunnen-warning: var(--warning-color, #ff9800);
      --brunnen-error: var(--error-color, #f44336);
      display: block;
    }
    ha-card {
      background: var(--brunnen-card-bg);
      color: var(--brunnen-primary-text);
      overflow: hidden;
      padding: 16px;
    }
    .header {
      align-items: center;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .title {
      font-size: 1.1rem;
      font-weight: 600;
      line-height: 1.25;
    }
    .badge {
      border-radius: 999px;
      color: #fff;
      flex: 0 0 auto;
      font-size: .75rem;
      font-weight: 700;
      letter-spacing: .04em;
      padding: 5px 9px;
      text-transform: uppercase;
    }
    .badge.idle { background: var(--brunnen-secondary-text); }
    .badge.running { background: var(--brunnen-ok); }
    .badge.warning { background: var(--brunnen-warning); }
    .badge.error { background: var(--brunnen-error); }
    .badge.unavailable { background: var(--disabled-text-color, #9e9e9e); }
    .scene { display: block; inline-size: 100%; max-block-size: 260px; }
    .water { fill: var(--brunnen-water); opacity: .78; }
    .pipe { fill: none; stroke: var(--brunnen-accent); stroke-linecap: round; stroke-width: 12; }
    .pipe-bg { fill: none; stroke: var(--divider-color, #e0e0e0); stroke-linecap: round; stroke-width: 16; }
    .flow-dot { fill: var(--brunnen-water); opacity: 0; }
    .running .flow-dot { animation: brunnen-flow 1.35s linear infinite; opacity: 1; }
    .running .flow-dot:nth-of-type(2) { animation-delay: .45s; }
    .running .flow-dot:nth-of-type(3) { animation-delay: .9s; }
    .pump { fill: var(--brunnen-ok); }
    .idle .pump, .unavailable .pump { fill: var(--brunnen-secondary-text); }
    .warning .pump { fill: var(--brunnen-warning); }
    .error .pump { fill: var(--brunnen-error); }
    .metrics {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin-top: 12px;
    }
    .metric {
      background: color-mix(in srgb, var(--brunnen-accent) 8%, transparent);
      border-radius: 12px;
      min-width: 0;
      padding: 10px;
      text-align: center;
    }
    .metric .label { color: var(--brunnen-secondary-text); font-size: .75rem; }
    .metric .value { font-size: 1rem; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @keyframes brunnen-flow {
      0% { offset-distance: 0%; opacity: 0; }
      10%, 90% { opacity: 1; }
      100% { offset-distance: 100%; opacity: 0; }
    }
    .flow-dot { offset-path: path('M 102 148 C 156 86, 258 90, 306 148 S 454 210, 506 148'); }
    @media (prefers-reduced-motion: reduce) {
      .running .flow-dot { animation: none; opacity: .85; }
      *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
    }
  `;

  class BrunnenFlowCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._config = { ...DEFAULT_CONFIG };
      this._hass = undefined;
      this._entityIds = [];
      this._lastSignature = '';
    }

    setConfig(config = {}) {
      this._config = { ...DEFAULT_CONFIG, ...config };
      this._entityIds = ENTITY_KEYS.map((key) => this._config[key]).filter(Boolean);
      this._lastSignature = '';
      this._render();
    }

    set hass(hass) {
      const nextSignature = this._buildSignature(hass);
      if (nextSignature === this._lastSignature) return;
      this._hass = hass;
      this._lastSignature = nextSignature;
      this._render();
    }

    getCardSize() { return 4; }

    _stateObj(entityId) { return entityId && this._hass ? this._hass.states[entityId] : undefined; }
    _state(entityId) { return this._stateObj(entityId)?.state; }
    _isMissing(state) { return UNAVAILABLE_STATES.has(state); }
    _format(entityId, fallback = '—') {
      const entity = this._stateObj(entityId);
      if (!entity || this._isMissing(entity.state)) return fallback;
      const unit = entity.attributes?.unit_of_measurement ? ` ${entity.attributes.unit_of_measurement}` : '';
      return `${entity.state}${unit}`;
    }

    _buildSignature(hass) {
      if (!hass || !this._entityIds.length) return 'no-hass';
      return this._entityIds.map((id) => {
        const entity = hass.states[id];
        return `${id}:${entity?.state ?? 'missing'}:${entity?.attributes?.unit_of_measurement ?? ''}`;
      }).join('|');
    }

    _status() {
      const status = String(this._state(this._config.status_entity) ?? '').toLowerCase();
      const pump = String(this._state(this._config.pump_entity) ?? '').toLowerCase();
      const level = String(this._state(this._config.level_entity) ?? '').toLowerCase();
      const candidates = [status, pump, level];
      if (candidates.some((value) => ERROR_STATES.has(value))) return ['error', 'Fehler'];
      if (candidates.some((value) => WARNING_STATES.has(value))) return ['warning', 'Warnung'];
      if (ON_STATES.has(pump) || ON_STATES.has(status)) return ['running', 'Aktiv'];
      if (candidates.every((value) => !value || UNAVAILABLE_STATES.has(value))) return ['unavailable', 'Unbekannt'];
      return ['idle', 'Bereit'];
    }

    _render() {
      const [statusClass, statusLabel] = this._status();
      const title = this._config.title || DEFAULT_CONFIG.title;
      this.shadowRoot.innerHTML = `
        <style>${css}</style>
        <ha-card class="${statusClass}">
          <div class="header">
            <div class="title">${this._escape(title)}</div>
            <div class="badge ${statusClass}">${statusLabel}</div>
          </div>
          <svg class="scene ${statusClass}" viewBox="0 0 608 250" role="img" aria-label="Brunnen Durchfluss">
            <defs>
              <linearGradient id="tank" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--brunnen-water)" stop-opacity=".35"/><stop offset="1" stop-color="var(--brunnen-water)" stop-opacity=".85"/></linearGradient>
            </defs>
            <rect x="34" y="70" width="86" height="132" rx="14" fill="none" stroke="var(--divider-color, #e0e0e0)" stroke-width="8"/>
            <rect x="44" y="124" width="66" height="68" rx="8" fill="url(#tank)"/>
            <path class="pipe-bg" d="M 102 148 C 156 86, 258 90, 306 148 S 454 210, 506 148"/>
            <path class="pipe" d="M 102 148 C 156 86, 258 90, 306 148 S 454 210, 506 148"/>
            <circle class="flow-dot" r="8"/><circle class="flow-dot" r="8"/><circle class="flow-dot" r="8"/>
            <circle class="pump" cx="528" cy="148" r="36"/><path d="M514 132h28l18 16-18 16h-28z" fill="var(--brunnen-card-bg)" opacity=".9"/>
            <path d="M72 70V42h318v58" fill="none" stroke="var(--secondary-text-color, #727272)" stroke-width="6" stroke-linecap="round" stroke-dasharray="10 10" opacity=".45"/>
          </svg>
          <div class="metrics">
            <div class="metric"><div class="label">Durchfluss</div><div class="value">${this._escape(this._format(this._config.flow_entity))}</div></div>
            <div class="metric"><div class="label">Füllstand</div><div class="value">${this._escape(this._format(this._config.level_entity))}</div></div>
            <div class="metric"><div class="label">Druck</div><div class="value">${this._escape(this._format(this._config.pressure_entity))}</div></div>
          </div>
        </ha-card>`;
    }

    _escape(value) {
      return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    }
  }

  for (const type of CARD_TYPES) {
    if (!customElements.get(type)) {
      customElements.define(type, class extends BrunnenFlowCard {});
    }
  }

  window.customCards = window.customCards || [];
  if (!window.customCards.some((card) => CARD_TYPES.includes(card.type))) {
    window.customCards.push({
      type: 'brunnen-flow-card',
      name: 'Brunnen Flow Card',
      description: 'Visualisiert Brunnenstatus, Durchfluss, Füllstand und Druck.',
    });
  }
})();
