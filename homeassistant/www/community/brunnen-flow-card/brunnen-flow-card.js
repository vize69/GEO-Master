(() => {
  'use strict';

  const CARD_TYPES = [
    'brunnen-flow-card',
    'vize-brunnen-flow-card-premium-v17',
    'vize-brunnen-flow-card-premium-v16',
  ];

  const DEFAULT_CONFIG = Object.freeze({
    title: 'Brunnen',
    entities: Object.freeze({
      pump: 'switch.brunnen_pumpe',
      level: 'sensor.brunnen_fuellstand',
      flow: 'sensor.brunnen_durchfluss',
      pressure: 'sensor.brunnen_druck',
      status: 'sensor.brunnen_status',
    }),
  });

  const UNAVAILABLE_STATES = new Set(['unknown', 'unavailable', undefined, null]);
  const ACTIVE_STATES = new Set(['on', 'open', 'running', 'active', 'true', '1', 'pumping']);
  const STATUS_PRIORITY = Object.freeze([
    { key: 'error', label: 'Störung', match: ['error', 'alarm', 'problem', 'fault', 'störung'] },
    { key: 'warning', label: 'Warnung', match: ['warning', 'warnung', 'low', 'niedrig'] },
    { key: 'running', label: 'Aktiv', match: ['running', 'active', 'on', 'pumping', 'läuft'] },
    { key: 'idle', label: 'Bereit', match: ['idle', 'ready', 'off', 'standby', 'bereit'] },
  ]);

  const num = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const stateObj = (hass, entityId) => (entityId && hass && hass.states ? hass.states[entityId] : undefined);

  const safeState = (entity) => (entity && !UNAVAILABLE_STATES.has(entity.state) ? entity.state : undefined);

  const entityName = (entity, fallback) => entity?.attributes?.friendly_name || fallback;

  const unit = (entity, fallback = '') => entity?.attributes?.unit_of_measurement || fallback;

  const formatValue = (entity, fallback = '—') => {
    const state = safeState(entity);
    return state === undefined ? fallback : `${state}${unit(entity) ? ` ${unit(entity)}` : ''}`;
  };

  const normalizeEntities = (config) => ({
    ...DEFAULT_CONFIG.entities,
    ...(config.entities || {}),
    pump: config.pump_entity || config.entity || config.entities?.pump || DEFAULT_CONFIG.entities.pump,
    level: config.level_entity || config.entities?.level || DEFAULT_CONFIG.entities.level,
    flow: config.flow_entity || config.entities?.flow || DEFAULT_CONFIG.entities.flow,
    pressure: config.pressure_entity || config.entities?.pressure || DEFAULT_CONFIG.entities.pressure,
    status: config.status_entity || config.entities?.status || DEFAULT_CONFIG.entities.status,
  });

  const statusFrom = ({ pump, status, level }) => {
    const raw = String(safeState(status) || '').toLowerCase();
    const priority = STATUS_PRIORITY.find(({ match }) => match.some((token) => raw.includes(token)));
    if (priority) return priority;

    const levelValue = num(safeState(level));
    if (levelValue !== undefined && levelValue <= 15) return STATUS_PRIORITY[1];

    const pumpState = String(safeState(pump) || '').toLowerCase();
    if (ACTIVE_STATES.has(pumpState)) return STATUS_PRIORITY[2];

    return STATUS_PRIORITY[3];
  };

  class BrunnenFlowCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._config = { ...DEFAULT_CONFIG };
      this._entities = normalizeEntities(this._config);
      this._lastSignature = '';
      this._root = undefined;
    }

    setConfig(config = {}) {
      this._config = { ...DEFAULT_CONFIG, ...config };
      this._entities = normalizeEntities(this._config);
      this._lastSignature = '';
      this._ensureLayout();
    }

    set hass(hass) {
      this._hass = hass;
      this._ensureLayout();

      const signature = this._signature(hass);
      if (signature === this._lastSignature) return;
      this._lastSignature = signature;
      this._renderState();
    }

    getCardSize() {
      return 4;
    }

    _signature(hass) {
      return Object.values(this._entities)
        .filter(Boolean)
        .map((entityId) => {
          const entity = stateObj(hass, entityId);
          return `${entityId}:${entity?.state ?? 'missing'}:${entity?.last_changed ?? ''}:${unit(entity)}`;
        })
        .join('|');
    }

    _ensureLayout() {
      if (this._root) return;
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            --brunnen-primary: var(--primary-color, #03a9f4);
            --brunnen-accent: var(--accent-color, #00c853);
            --brunnen-warning: var(--warning-color, #ff9800);
            --brunnen-error: var(--error-color, #db4437);
            --brunnen-card-bg: var(--ha-card-background, var(--card-background-color, #ffffff));
            --brunnen-text: var(--primary-text-color, #212121);
            --brunnen-secondary: var(--secondary-text-color, #727272);
            --brunnen-divider: var(--divider-color, rgba(0, 0, 0, 0.12));
            display: block;
          }
          ha-card {
            background: var(--brunnen-card-bg);
            color: var(--brunnen-text);
            overflow: hidden;
          }
          .card {
            padding: 16px;
          }
          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 12px;
          }
          .title {
            font-size: 1.15rem;
            font-weight: 600;
          }
          .badge {
            border-radius: 999px;
            color: #fff;
            font-size: .78rem;
            font-weight: 700;
            padding: 4px 10px;
            text-transform: uppercase;
          }
          .badge.idle { background: var(--brunnen-secondary); }
          .badge.running { background: var(--brunnen-accent); }
          .badge.warning { background: var(--brunnen-warning); }
          .badge.error { background: var(--brunnen-error); }
          .visual {
            border: 1px solid var(--brunnen-divider);
            border-radius: 14px;
            padding: 10px;
            background: linear-gradient(180deg, rgba(3, 169, 244, .08), transparent);
          }
          svg { width: 100%; height: auto; display: block; }
          .water { fill: rgba(3, 169, 244, .32); transition: y .35s ease, height .35s ease; }
          .pipe { fill: none; stroke: var(--brunnen-primary); stroke-width: 10; stroke-linecap: round; opacity: .95; }
          .flow { fill: none; stroke: var(--brunnen-accent); stroke-width: 4; stroke-linecap: round; stroke-dasharray: 10 12; animation: brunnen-flow 1s linear infinite; }
          .pump { fill: var(--brunnen-primary); opacity: .9; }
          .pump.running { fill: var(--brunnen-accent); animation: brunnen-pulse 1.4s ease-in-out infinite; }
          .stats {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
            margin-top: 12px;
          }
          .stat {
            border-radius: 12px;
            background: rgba(127, 127, 127, .08);
            padding: 10px;
            min-width: 0;
          }
          .label { color: var(--brunnen-secondary); font-size: .75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .value { font-size: 1rem; font-weight: 700; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          @keyframes brunnen-flow { to { stroke-dashoffset: -22; } }
          @keyframes brunnen-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.035); } }
          @media (prefers-reduced-motion: reduce) {
            .flow, .pump.running { animation: none; }
            .water { transition: none; }
          }
        </style>
        <ha-card>
          <div class="card">
            <div class="header">
              <div class="title"></div>
              <div class="badge idle"></div>
            </div>
            <div class="visual">
              <svg viewBox="0 0 420 220" role="img" aria-label="Brunnen Flow Visualisierung">
                <defs>
                  <clipPath id="wellClip"><rect x="36" y="34" width="92" height="154" rx="12" /></clipPath>
                </defs>
                <rect x="36" y="34" width="92" height="154" rx="12" fill="none" stroke="var(--brunnen-divider)" stroke-width="8" />
                <rect class="water" x="40" y="188" width="84" height="0" clip-path="url(#wellClip)" />
                <path class="pipe" d="M128 112 H202 C232 112 232 70 262 70 H354" />
                <path class="flow" d="M134 112 H202 C232 112 232 70 262 70 H350" />
                <g class="pump" transform="translate(188 86)">
                  <circle cx="32" cy="32" r="30" />
                  <path d="M20 32 h24 m-12 -12 v24" stroke="#fff" stroke-width="8" stroke-linecap="round" />
                </g>
                <path d="M354 70 c20 0 20 32 0 32 c-18 0 -18 -32 0 -32" fill="none" stroke="var(--brunnen-primary)" stroke-width="8" />
                <text class="levelText" x="82" y="207" text-anchor="middle" fill="var(--brunnen-secondary)" font-size="14"></text>
              </svg>
            </div>
            <div class="stats">
              <div class="stat"><div class="label flowLabel"></div><div class="value flowValue"></div></div>
              <div class="stat"><div class="label pressureLabel"></div><div class="value pressureValue"></div></div>
              <div class="stat"><div class="label pumpLabel"></div><div class="value pumpValue"></div></div>
            </div>
          </div>
        </ha-card>`;
      this._root = this.shadowRoot;
    }

    _renderState() {
      const entities = {
        pump: stateObj(this._hass, this._entities.pump),
        level: stateObj(this._hass, this._entities.level),
        flow: stateObj(this._hass, this._entities.flow),
        pressure: stateObj(this._hass, this._entities.pressure),
        status: stateObj(this._hass, this._entities.status),
      };
      const status = statusFrom(entities);
      const levelValue = clamp(num(safeState(entities.level)) ?? 0, 0, 100);
      const waterHeight = 154 * (levelValue / 100);
      const isRunning = status.key === 'running';

      this._root.querySelector('.title').textContent = this._config.title || DEFAULT_CONFIG.title;
      const badge = this._root.querySelector('.badge');
      badge.className = `badge ${status.key}`;
      badge.textContent = status.label;
      this._root.querySelector('.water').setAttribute('y', String(188 - waterHeight));
      this._root.querySelector('.water').setAttribute('height', String(waterHeight));
      this._root.querySelector('.pump').classList.toggle('running', isRunning);
      this._root.querySelector('.flow').style.visibility = isRunning ? 'visible' : 'hidden';
      this._root.querySelector('.levelText').textContent = `${levelValue || 0}%`;
      this._root.querySelector('.flowLabel').textContent = entityName(entities.flow, 'Durchfluss');
      this._root.querySelector('.flowValue').textContent = formatValue(entities.flow);
      this._root.querySelector('.pressureLabel').textContent = entityName(entities.pressure, 'Druck');
      this._root.querySelector('.pressureValue').textContent = formatValue(entities.pressure);
      this._root.querySelector('.pumpLabel').textContent = entityName(entities.pump, 'Pumpe');
      this._root.querySelector('.pumpValue').textContent = formatValue(entities.pump);
    }
  }

  CARD_TYPES.forEach((type) => {
    if (!customElements.get(type)) customElements.define(type, BrunnenFlowCard);
  });

  window.customCards = window.customCards || [];
  CARD_TYPES.forEach((type) => {
    if (!window.customCards.some((card) => card.type === type)) {
      window.customCards.push({
        type,
        name: type === 'brunnen-flow-card' ? 'Brunnen Flow Card' : `Brunnen Flow Card (${type})`,
        description: 'Visualisiert Brunnenstatus, Füllstand, Durchfluss und Druck ohne Service-Calls.',
      });
    }
  });
})();
