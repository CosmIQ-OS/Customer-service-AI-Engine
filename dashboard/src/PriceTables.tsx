import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

type AnyRow = Record<string, any>;

interface PriceTable {
  id: number;
  version: number;
  status: 'active' | 'superseded';
  source_filename: string;
  item_count: number;
  currency: string;
  uploaded_at: string;
}

interface PriceItem {
  id: number;
  item_code: string;
  description: string;
  unit: string;
  unit_price_paise: number;
}

interface UploadError {
  row: number;
  message: string;
}

const TEMPLATE = 'item_code,description,unit,unit_price\nEXAMPLE-01,Example service item,hour,1500.00\n';
const MAX_BYTES = 700 * 1024;

function formatInr(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}

function fmtTime(v?: string): string {
  if (!v) return '';
  const d = new Date(v.includes('Z') ? v : v.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? v : d.toLocaleString();
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function PriceTables({ services }: { services: AnyRow[] }) {
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [table, setTable] = useState<PriceTable | null>(null);
  const [items, setItems] = useState<PriceItem[]>([]);
  const [history, setHistory] = useState<PriceTable[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<UploadError[]>([]);

  useEffect(() => {
    if (serviceId === null && services.length > 0) {
      const first = [...services].sort((a, b) => String(a.name).localeCompare(String(b.name)))[0];
      setServiceId(first.id);
    }
  }, [services, serviceId]);

  async function refresh(id: number) {
    const [current, history] = await Promise.all([
      api<{ table: PriceTable | null; items: PriceItem[] }>(`/api/services/${id}/price-table`),
      api<{ tables: PriceTable[] }>(`/api/services/${id}/price-tables`),
    ]);
    setTable(current.table);
    setItems(current.items);
    setHistory(history.tables);
  }

  useEffect(() => {
    if (serviceId === null) return;
    setMessage('');
    setErrors([]);
    refresh(serviceId).catch((err) => setMessage(err instanceof Error ? err.message : 'Could not load price table'));
  }, [serviceId]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || serviceId === null) return;
    setBusy(true);
    setMessage('');
    setErrors([]);
    try {
      if (file.size > MAX_BYTES) throw new Error(`Price tables must be ${MAX_BYTES / 1024} KB or smaller.`);
      const contentBase64 = toBase64(await file.arrayBuffer());
      const result = await api<{ table: PriceTable }>(`/api/services/${serviceId}/price-table`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentBase64 }),
      });
      setMessage(`Published version ${result.table.version} with ${result.table.item_count} items.`);
      setFile(null);
      setFileKey((key) => key + 1);
      await refresh(serviceId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setErrors(err.body?.errors ?? []);
      }
      setMessage(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  const orderedServices = [...services].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const selected = orderedServices.find((service) => service.id === serviceId);

  return (
    <section className="card">
      <h2 className="panel-title">Price Tables <span>INR, uploaded by admins</span></h2>
      {services.length === 0 ? (
        <div className="muted small">No services yet.</div>
      ) : (
        <>
          <label>Service
            <select value={serviceId ?? ''} onChange={(e) => setServiceId(Number(e.target.value))}>
              {orderedServices.map((service) => (
                <option key={service.id} value={service.id}>{service.name}</option>
              ))}
            </select>
          </label>

          {table ? (
            <p className="small">
              <strong>Version {table.version}</strong> · {table.item_count} items · {table.source_filename} · uploaded {fmtTime(table.uploaded_at)}
            </p>
          ) : (
            <p className="muted small">No price table for {selected?.name} yet.</p>
          )}

          {items.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Code</th><th>Description</th><th>Unit</th><th>Unit price</th></tr></thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="mono">{item.item_code}</td>
                      <td>{item.description}</td>
                      <td>{item.unit}</td>
                      <td>{formatInr(item.unit_price_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form className="form" onSubmit={upload} style={{ marginTop: 14 }}>
            <label>Upload a new version (.xlsx or .csv)
              <input
                key={fileKey}
                type="file"
                accept=".xlsx,.csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <div className="toolbar">
              <button className="btn" type="submit" disabled={!file || busy}>{busy ? 'Uploading…' : 'Publish version'}</button>
              <a
                className="btn secondary"
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
                download="price-table-template.csv"
              >
                CSV template
              </a>
            </div>
            <span className="muted small">Columns: item_code, description, unit, unit_price. Publishing replaces the active table; earlier versions are kept.</span>
          </form>

          {message && <div className={errors.length ? 'card error' : 'success'} style={{ marginTop: 12 }}>{message}</div>}
          {errors.length > 0 && (
            <ul className="small">
              {errors.map((error, index) => (
                <li key={index}>{error.row > 0 ? `Row ${error.row}: ` : ''}{error.message}</li>
              ))}
            </ul>
          )}

          {history.length > 1 && (
            <>
              <h3 className="small" style={{ marginTop: 16 }}>Version history</h3>
              <ul className="small">
                {history.map((version) => (
                  <li key={version.id}>
                    v{version.version} · <span className="pill">{version.status}</span> · {version.item_count} items · {version.source_filename} · {fmtTime(version.uploaded_at)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
