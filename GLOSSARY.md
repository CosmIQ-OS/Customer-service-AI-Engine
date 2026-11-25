# Domain Glossary

Key domain and technical terms used across **CosmIQ OS Customer Service AI Engine**.

| Term | Meaning |
| --- | --- |
| **Session** | A per-customer, per-channel conversation identity (`sessions` table) carrying status, language metadata, and message history. |
| **Conversation Mode** | Controls who replies to a customer: `ai` (automated agent), `human` (operator took over), or `paused` (AI muted while waiting). |
| **Takeover / Handback** | Operator actions in the Live Inbox to switch a conversation from `ai` to `human` (`takeover`) and return it to `ai` (`handback`). |
| **Intake (Lead)** | Structured discovery record (`service_intakes`) capturing `company_name`, `company_size`, `current_tools`, `service_name`, and contact info from chat or website forms. |
| **Price Table** | Versioned CSV/XLSX catalog (`price_tables` + `price_items`) of internal unit prices in paise for a given service. Publishing a new version supersedes the previous active version. |
| **Quote** | Pricing-agent-generated itemized estimate (`quotes` + `quote_items`) applying an admin-controlled margin (`30%–35%`) over internal price table costs. Requires admin approval before customer delivery. |
| **Approval Window** | Configured interval (`QUOTE_APPROVAL_WINDOW_HOURS`, default 6h) after which unreviewed pending quotes re-alert admins. |
| **Invoice** | Direct billing document created by an admin in the dashboard (stored in `quotes` with `INV-YYYY-XXXX` numbering and `0%` margin, status `pending` / `paid` / `draft`). |
| **Contract Proposal** | Multi-section formal client proposal (`contract_proposals`, `PROP-YYYY-XXXX`) with scope, phases, payment schedules, and digital signatures, exportable as PDF. |
| **Price Guard** | Deterministic outbound filter (`src/engine/price-guard.ts`) that blocks unapproved pricing leaks from AI replies before sending to the customer. |
| **PGlite / Neon** | Dual PostgreSQL runtime: Neon pooled/unpooled Postgres in production (`DATABASE_URL`), or embedded PGlite (`DB_PATH` / `:memory:`) for zero-setup local dev and unit tests. |
| **Paise** | Integer minor currency unit for INR (`100 paise = ₹1`), used across DB columns (`*_paise`) to avoid floating-point rounding drift. |
