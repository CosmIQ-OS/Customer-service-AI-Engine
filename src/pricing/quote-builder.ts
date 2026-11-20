import type { DB } from '../db/database.js';
import type { MessageRecord } from '../engine/types.js';
import type { IntakeRecord } from '../intake/intake.js';
import { activePriceTable, listPriceItems } from '../db/repositories/pricing.js';
import {
  createQuote,
  listQuoteItems,
  type QuoteItemInput,
  type QuoteItemRecord,
  type QuoteRecord,
} from '../db/repositories/quotes.js';
import { applyMargin } from './margin.js';
import type { PricingAgent } from './pricing-agent.js';

export interface BuiltQuote {
  quote: QuoteRecord;
  items: QuoteItemRecord[];
}

export class QuoteBuilder {
  constructor(private readonly db: DB, private readonly agent: PricingAgent) {}

  async build(input: {
    intake: IntakeRecord;
    history: MessageRecord[];
    marginPercent: number;
  }): Promise<BuiltQuote> {
    const serviceId = input.intake.service_id;
    if (!serviceId) throw new Error('The intake has no catalog service selected.');

    const table = await activePriceTable(this.db, serviceId);
    if (!table) {
      throw new Error(`No active price table for ${input.intake.service_name || 'this service'}.`);
    }
    const priceItems = await listPriceItems(this.db, table.id);
    if (priceItems.length === 0) throw new Error('The active price table is empty.');

    const selection = await this.agent.select({
      intake: input.intake,
      history: input.history,
      items: priceItems,
    });

    const items: QuoteItemInput[] = selection.items.map(({ item, quantity }) => {
      const quotedUnitPricePaise = applyMargin(item.unit_price_paise, input.marginPercent);
      return {
        priceItemId: item.id,
        itemCode: item.item_code,
        description: item.description,
        unit: item.unit,
        quantity,
        adminUnitPricePaise: item.unit_price_paise,
        quotedUnitPricePaise,
        lineTotalPaise: Math.round(quotedUnitPricePaise * quantity),
      };
    });

    const quote = await createQuote(this.db, {
      sessionId: input.intake.session_id,
      channel: input.intake.channel,
      externalUserId: input.intake.external_user_id,
      intakeId: input.intake.id,
      serviceId,
      serviceName: input.intake.service_name,
      marginPercent: input.marginPercent,
      notes: selection.notes,
      items,
    });

    return { quote, items: await listQuoteItems(this.db, quote.id) };
  }
}
