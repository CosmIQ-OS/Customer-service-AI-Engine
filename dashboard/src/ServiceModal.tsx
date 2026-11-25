import { useState, useEffect } from 'react';
import { api } from './api';

export interface ServiceData {
  id?: number;
  name: string;
  category: string;
  description: string;
  status: 'available' | 'unavailable' | 'maintenance' | 'limited';
  base_price_paise: number;
}

interface ServiceModalProps {
  service: ServiceData | null; // null for new, object for edit
  onClose: () => void;
  onSaved: () => void;
}

export function ServiceModal({ service, onClose, onSaved }: ServiceModalProps) {
  const [name, setName] = useState(service?.name ?? '');
  const [category, setCategory] = useState(service?.category ?? 'automation');
  const [description, setDescription] = useState(service?.description ?? '');
  const [status, setStatus] = useState<ServiceData['status']>(service?.status ?? 'available');
  const [priceInr, setPriceInr] = useState(service ? String((service.base_price_paise || 0) / 100) : '25000');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isEdit = Boolean(service?.id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Service name is required.');
      return;
    }
    const numPrice = Number(priceInr);
    if (!Number.isFinite(numPrice) || numPrice < 0) {
      setError('Base price must be a non-negative number.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        category: category.trim() || 'general',
        description: description.trim(),
        status,
        base_price_paise: Math.round(numPrice * 100),
      };

      if (isEdit && service?.id) {
        await api(`/api/services/${service.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api('/api/services', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to save service.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-title">
            <strong>{isEdit ? 'Edit Service' : 'Add New Service'}</strong>
          </div>
          <button type="button" className="banner-close" onClick={onClose} aria-label="Close service modal">✕</button>
        </div>

        {error && <div className="banner error">{error}</div>}

        <form onSubmit={handleSubmit} className="form">
          <label>
            Service Name *
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. WhatsApp Agent Services"
            />
          </label>

          <div className="grid-2">
            <label>
              Category
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="automation, integration, support"
              />
            </label>

            <label>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
                <option value="available">available (Active)</option>
                <option value="limited">limited (High Demand)</option>
                <option value="maintenance">maintenance (Offline)</option>
                <option value="unavailable">unavailable (Disabled)</option>
              </select>
            </label>
          </div>

          <label>
            Base Price (INR ₹) *
            <input
              type="number"
              min="0"
              step="500"
              required
              value={priceInr}
              onChange={(e) => setPriceInr(e.target.value)}
              placeholder="e.g. 50000"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
            <span className="small muted">Base standard price for 0-5 team size before multipliers.</span>
          </label>

          <label>
            Description &amp; Availability Note
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe deliverables, scope, or scheduling expectations…"
            />
          </label>

          <div className="toolbar" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Service'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
