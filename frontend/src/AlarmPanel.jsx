/**
 * AlarmPanel — slide-in panel for creating and managing temperature alarms.
 * Renders as an absolute overlay so it doesn't disturb the 3D canvas layout.
 */
import React, { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  BellIcon,
  MapPinIcon,
  TrashIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  Cancel01Icon,
  AlertCircleIcon,
  RadioButtonIcon,
} from '@hugeicons/core-free-icons';
import { DEPTHS_M, DEPTH_LABELS } from './alarm-config';

// ── constants ─────────────────────────────────────────────────────────────

const STATUS_COLOR = {
  active:  '#4fc3f7',
  firing:  '#ef5350',
  error:   '#ffa726',
};

// Maps alarm status → a HugeIcon component
const STATUS_ICON_COMPONENT = {
  active: RadioButtonIcon,
  firing: AlertCircleIcon,
  error:  AlertCircleIcon,
};

// ── sub-components ────────────────────────────────────────────────────────

function AlarmForm({ onAdd, prefillLat, prefillLon, targetMonth }) {
  const [lat, setLat]         = useState(prefillLat?.toFixed(4) ?? '');
  const [lon, setLon]         = useState(prefillLon?.toFixed(4) ?? '');
  const [month, setMonth]     = useState(targetMonth ?? '2020-03');
  const [depthIdx, setDepthIdx] = useState(0);
  const [condition, setCondition] = useState('above');
  const [threshold, setThreshold] = useState('');
  const [label, setLabel]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!threshold) return setErr('Threshold is required.');
    setBusy(true);
    try {
      await onAdd({
        latitude:           parseFloat(lat),
        longitude:          parseFloat(lon),
        target_month:       month,
        depth_index:        parseInt(depthIdx, 10),
        condition,
        threshold_celsius:  parseFloat(threshold),
        label,
      });
      setThreshold('');
      setLabel('');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const input = (value, setter, props = {}) => (
    <input
      value={value}
      onChange={e => setter(e.target.value)}
      style={{
        width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 6, color: '#fff', padding: '6px 10px', fontSize: 13, boxSizing: 'border-box',
      }}
      {...props}
    />
  );

  const sel = (value, setter, children) => (
    <select
      value={value}
      onChange={e => setter(e.target.value)}
      style={{
        width: '100%', background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 6, color: '#fff', padding: '6px 10px', fontSize: 13,
      }}
    >
      {children}
    </select>
  );

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label style={labelStyle}>Latitude</label>
          {input(lat, setLat, { type: 'number', step: 'any', min: -90, max: 90, required: true, placeholder: '0.00' })}
        </div>
        <div>
          <label style={labelStyle}>Longitude</label>
          {input(lon, setLon, { type: 'number', step: 'any', min: -180, max: 360, required: true, placeholder: '0.00' })}
        </div>
      </div>

      <div>
        <label style={labelStyle}>Month (YYYY-MM)</label>
        {input(month, setMonth, { pattern: '^\\d{4}-\\d{2}$', required: true, placeholder: '2020-03' })}
      </div>

      <div>
        <label style={labelStyle}>Depth</label>
        {sel(depthIdx, setDepthIdx,
          DEPTH_LABELS.map((lbl, i) => <option key={i} value={i}>{lbl}</option>)
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label style={labelStyle}>Condition</label>
          {sel(condition, setCondition, <>
            <option value="above">Above</option>
            <option value="below">Below</option>
          </>)}
        </div>
        <div>
          <label style={labelStyle}>Threshold (°C)</label>
          {input(threshold, setThreshold, { type: 'number', step: 'any', required: true, placeholder: '20.0' })}
        </div>
      </div>

      <div>
        <label style={labelStyle}>Label (optional)</label>
        {input(label, setLabel, { maxLength: 120, placeholder: 'e.g. warm surface alert' })}
      </div>

      {err && <p style={{ color: '#ef5350', fontSize: 12, margin: 0 }}>{err}</p>}

      <button
        type="submit"
        disabled={busy}
        style={{
          marginTop: 4, padding: '8px 0', borderRadius: 8, border: 'none',
          background: busy ? '#333' : 'linear-gradient(90deg,#0288d1,#26c6da)',
          color: '#fff', fontWeight: 700, fontSize: 14, cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Adding…' : '+ Set Alarm'}
      </button>
    </form>
  );
}

function AlarmRow({ alarm, onRemove }) {
  const color = STATUS_COLOR[alarm.status] ?? '#aaa';
  const StatusIcon = STATUS_ICON_COMPONENT[alarm.status] ?? RadioButtonIcon;
  return (
    <div style={{
      background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '10px 12px',
      border: `1px solid ${color}44`, position: 'relative',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color, display: 'flex', alignItems: 'center', gap: 6 }}>
          <HugeiconsIcon icon={StatusIcon} size={14} color={color} />
          {alarm.status.toUpperCase()}
        </span>
        <button
          onClick={() => onRemove(alarm.id)}
          style={{
            background: 'none', border: 'none', color: '#888', cursor: 'pointer',
            lineHeight: 1, padding: '0 2px', display: 'flex', alignItems: 'center',
          }}
          title="Delete alarm"
        >
          <HugeiconsIcon icon={TrashIcon} size={14} />
        </button>
      </div>

      {alarm.label && (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#ccc', fontStyle: 'italic' }}>{alarm.label}</p>
      )}

      <p style={{ margin: '6px 0 0', fontSize: 12, color: '#aaa', display: 'flex', alignItems: 'center', gap: 5 }}>
        <HugeiconsIcon icon={MapPinIcon} size={12} />
        {alarm.latitude.toFixed(2)}°, {alarm.longitude.toFixed(2)}°
        &nbsp;·&nbsp;{alarm.target_month}
        &nbsp;·&nbsp;{DEPTH_LABELS[alarm.depth_index]}
      </p>
      <p style={{ margin: '3px 0 0', fontSize: 12, color: '#aaa', display: 'flex', alignItems: 'center', gap: 4 }}>
        <HugeiconsIcon icon={alarm.condition === 'above' ? ChevronUpIcon : ChevronDownIcon} size={12} />
        {alarm.threshold_celsius.toFixed(2)}°C
        {alarm.last_value_celsius != null && (
          <span style={{ color: '#fff' }}> — last: {alarm.last_value_celsius.toFixed(2)}°C</span>
        )}
      </p>
      {alarm.status === 'firing' && alarm.triggered_at && (
        <p style={{ margin: '3px 0 0', fontSize: 11, color: '#ef5350', display: 'flex', alignItems: 'center', gap: 5 }}>
          <HugeiconsIcon icon={BellIcon} size={11} />
          Firing since {new Date(alarm.triggered_at).toLocaleTimeString()}
        </p>
      )}
      {alarm.status === 'error' && alarm.error_detail && (
        <p style={{ margin: '3px 0 0', fontSize: 11, color: '#ffa726', wordBreak: 'break-all' }}>
          {alarm.error_detail}
        </p>
      )}
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────

export default function AlarmPanel({
  alarms,
  onAdd,
  onRemove,
  error,
  prefillLat,
  prefillLon,
  targetMonth,
  onClose,
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{
      position: 'absolute', top: 20, right: 20,
      width: 300,
      background: 'rgba(10,10,20,0.95)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 14,
      backdropFilter: 'blur(20px)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      overflow: 'hidden',
      zIndex: 100,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <span style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 7 }}>
          <HugeiconsIcon icon={BellIcon} size={16} /> Alarms
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setCollapsed(c => !c)} style={iconBtn}>
            <HugeiconsIcon icon={collapsed ? ChevronDownIcon : ChevronUpIcon} size={14} />
          </button>
          {onClose && (
            <button onClick={onClose} style={iconBtn}>
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '70vh', overflowY: 'auto' }}>
          <AlarmForm
            onAdd={onAdd}
            prefillLat={prefillLat}
            prefillLon={prefillLon}
            targetMonth={targetMonth}
          />

          {error && (
            <p style={{ color: '#ef5350', fontSize: 12, margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
              <HugeiconsIcon icon={AlertCircleIcon} size={13} /> {error}
            </p>
          )}

          {alarms.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#888', fontWeight: 600 }}>
                ACTIVE ALARMS ({alarms.length})
              </span>
              {alarms.map(a => (
                <AlarmRow key={a.id} alarm={a} onRemove={onRemove} />
              ))}
            </div>
          )}

          {alarms.length === 0 && (
            <p style={{ fontSize: 12, color: '#555', textAlign: 'center', margin: 0 }}>
              No alarms set. Fill the form above to add one.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── shared styles ──────────────────────────────────────────────────────────

const labelStyle = {
  display: 'block', fontSize: 11, color: '#888', marginBottom: 3, fontWeight: 600, letterSpacing: 0.5,
};

const iconBtn = {
  background: 'none', border: 'none', color: '#888', cursor: 'pointer',
  fontSize: 14, padding: '2px 4px', lineHeight: 1,
};
