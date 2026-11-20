# CosmIQ OS Website Lead Integration Guide (`cosmiqos.com`)

This guide explains how to connect the lead capture form on `cosmiqos.com` directly to the CosmIQ OS Customer Service AI Engine database and pipeline.

---

## 1. Endpoint Overview

- **URL**: `POST https://<your-engine-domain>/api/leads`
  - (Alternate alias: `POST https://<your-engine-domain>/api/intake/website`)
- **Authentication**: Public (no API key required from client browser).
- **Security & Rate Limiting**: Protected by server-side rate limiting (maximum 10 requests per minute per IP address). Exceeding requests receive `HTTP 429 Too Many Requests`.
- **CORS**: Configured on the engine to accept inbound requests from `cosmiqos.com` and local preview domains.

---

## 2. Request Payload Specification

Send a JSON `POST` request with `Content-Type: application/json`:

```json
{
  "company_name": "GreenTech Labs",
  "company_size": "10-20",
  "contact_person": "Alex Morgan",
  "email": "alex@greentech.io",
  "phone": "+91 98765 43210",
  "current_tools": "HubSpot, Slack, Google Workspace",
  "service_name": "WhatsApp Agent Services",
  "service_id": 4,
  "notes": "Looking to automate client inquiries and sync leads with HubSpot."
}
```

### Field Definitions

| Field | Type | Required | Description |
|---|---|---|---|
| `company_name` | `string` | **Yes** | Client organization or business name (1–255 chars). |
| `contact_person` | `string` | Optional* | Primary contact's full name. |
| `email` | `string` | Optional* | Contact email address. |
| `phone` | `string` | Optional* | WhatsApp or contact phone number. |
| `company_size` | `string` | Optional | Team size tier: `0-5`, `5-10`, `10-20`, or `20+`. |
| `current_tools` | `string` | Optional | Current tools used (e.g. HubSpot, Salesforce, Slack, Excel). |
| `service_name` | `string` | Optional | Name of the primary service of interest. |
| `service_id` | `number` | Optional | ID of the service from the CosmIQ OS catalog. |
| `notes` | `string` | Optional | Specific project requirements or message. |

*\*At least one contact method (`contact_person`, `email`, or `phone`) must be supplied.*

---

## 3. Server Response

### Success (`HTTP 201 Created`)
```json
{
  "ok": true,
  "message": "Thank you! Your inquiry has been received. Our team will contact you shortly.",
  "sessionId": "web-1732098000000-a1b2c3",
  "intakeId": 14
}
```

### Validation Error (`HTTP 400 Bad Request`)
```json
{
  "error": {
    "formErrors": ["Please provide at least a contact person, email, or phone number."],
    "fieldErrors": {
      "company_name": ["Company name is required"]
    }
  }
}
```

### Rate Limited (`HTTP 429 Too Many Requests`)
```json
{
  "error": "Too many lead submissions from this network. Please wait a moment and try again."
}
```

---

## 4. What Happens Inside CosmIQ OS
When a lead is submitted:
1. **Database Persistence**: Stored as a `service_intakes` record with `channel = 'website'`.
2. **Conversation & Transcript**: Creates a web session and user message in `messages` so the transcript is available.
3. **Admin Alerts & Notification Bell**: Triggers a notification in the top navbar bell (`New Website Lead: <Company>`).
4. **Live Inbox & Leads**: Appears under **03 LEADS & INTAKE** with the `WEBSITE` channel badge.
5. **Proposal Workflow**: Available in **04 PROPOSALS & QUOTES** when clicking **NEW PROPOSAL**—selecting the lead auto-fills company name, size, phone, and tools!

---

## 5. Ready-to-Use Code Snippet for `cosmiqos.com`

You can drop this modern, accessible React/HTML form directly into `cosmiqos.com`:

```tsx
import React, { useState } from 'react';

const ENGINE_API_URL = process.env.NEXT_PUBLIC_ENGINE_API_URL || 'https://engine.cosmiqos.com';

export function WebsiteLeadForm() {
  const [formData, setFormData] = useState({
    company_name: '',
    company_size: '5-10',
    contact_person: '',
    email: '',
    phone: '',
    current_tools: '',
    service_name: 'WhatsApp Agent Services',
    notes: '',
  });

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      const response = await fetch(`${ENGINE_API_URL}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.formErrors?.[0] || data.error || 'Failed to submit inquiry.');
      }

      setSuccess(true);
      setFormData({
        company_name: '',
        company_size: '5-10',
        contact_person: '',
        email: '',
        phone: '',
        current_tools: '',
        service_name: 'WhatsApp Agent Services',
        notes: '',
      });
    } catch (err: any) {
      setError(err.message || 'Network error. Please try again or email ops@cosmiqos.com.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lead-card" style={{ maxWidth: 540, margin: '0 auto', padding: 24, borderRadius: 12, border: '1px solid #d8d2c4', background: '#faf8f5', fontFamily: 'sans-serif' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: '1.25rem', color: '#181715' }}>Request a Custom Proposal</h3>
      <p style={{ margin: '0 0 20px', fontSize: '0.88rem', color: '#57524a' }}>
        Tell us about your team and workflow requirements. Our solutions engineering team will prepare your proposal.
      </p>

      {success && (
        <div style={{ padding: '12px 16px', marginBottom: 16, borderRadius: 8, background: '#d1fae5', color: '#065f46', fontSize: '0.9rem' }}>
          ✓ Thank you! Your inquiry has been received. Our team will contact you shortly with your custom proposal.
        </div>
      )}

      {error && (
        <div style={{ padding: '12px 16px', marginBottom: 16, borderRadius: 8, background: '#fee2e2', color: '#991b1b', fontSize: '0.9rem' }}>
          ✕ {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#181715', marginBottom: 4 }}>Company Name *</label>
          <input required type="text" name="company_name" value={formData.company_name} onChange={handleChange} placeholder="e.g. Acme Corporation" style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #d8d2c4', fontSize: '0.9rem' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#181715', marginBottom: 4 }}>Company Size</label>
            <select name="company_size" value={formData.company_size} onChange={handleChange} style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #d8d2c4', fontSize: '0.9rem' }}>
              <option value="0-5">1–5 employees</option>
              <option value="5-10">5–10 employees</option>
              <option value="10-20">10–20 employees</option>
              <option value="20+">20+ employees</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#181715', marginBottom: 4 }}>Contact Person</label>
            <input type="text" name="contact_person" value={formData.contact_person} onChange={handleChange} placeholder="Your full name" style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #d8d2c4', fontSize: '0.9rem' }} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#181715', marginBottom: 4 }}>Work Email</label>
            <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="you@company.com" style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #d8d2c4', fontSize: '0.9rem' }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#181715', marginBottom: 4 }}>WhatsApp / Phone</label>
            <input type="tel" name="phone" value={formData.phone} onChange={handleChange} placeholder="+91 98765 43210" style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #d8d2c4', fontSize: '0.9rem' }} />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#181715', marginBottom: 4 }}>Service Required</label>
          <select name="service_name" value={formData.service_name} onChange={handleChange} style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #d8d2c4', fontSize: '0.9rem' }}>
            <option value="WhatsApp Agent Services">WhatsApp Agent Services</option>
            <option value="Workflow Automation">Workflow Automation</option>
            <option value="AI Native Internal System">AI Native Internal System</option>
            <option value="Company Internal Operations Automation">Company Internal Operations Automation</option>
            <option value="API Integration Support">API Integration Support</option>
            <option value="Custom AI Consulting">Custom AI Consulting</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#181715', marginBottom: 4 }}>Current Tools in Use</label>
          <input type="text" name="current_tools" value={formData.current_tools} onChange={handleChange} placeholder="e.g. HubSpot, Slack, Google Sheets" style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #d8d2c4', fontSize: '0.9rem' }} />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#181715', marginBottom: 4 }}>Project Notes / Goals</label>
          <textarea rows={3} name="notes" value={formData.notes} onChange={handleChange} placeholder="What workflows or pain points would you like to solve?" style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #d8d2c4', fontSize: '0.9rem', resize: 'vertical' }} />
        </div>

        <button type="submit" disabled={loading} style={{ background: '#ff5a1f', color: '#fff', border: 'none', padding: '12px 20px', borderRadius: 6, fontSize: '0.95rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', marginTop: 6 }}>
          {loading ? 'Submitting…' : 'Submit Inquiry →'}
        </button>
      </form>
    </div>
  );
}
```
