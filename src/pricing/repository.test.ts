import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openDatabase, type DB } from '../db/database.js';
import * as pricingRepo from '../db/repositories/pricing.js';
import * as servicesRepo from '../db/repositories/services.js';

const databases: DB[] = [];
afterEach(async () => {
  while (databases.length) await databases.pop()?.close();
});

async function setup() {
  const db = await openDatabase(':memory:');
  databases.push(db);
  const service = await servicesRepo.createService(db, {
    name: 'Workflow Automation',
    description: '',
    category: 'workflow',
    status: 'available',
    availability_note: '',
  });
  return { db, serviceId: service.id };
}

const v1Items = [
  { item_code: 'A', description: 'Discovery', unit: 'hour', unit_price_paise: 100000 },
  { item_code: 'B', description: 'Build', unit: 'day', unit_price_paise: 500000 },
];

describe('pricing repository', () => {
  it('publishes version 1 as the active table', async () => {
    const { db, serviceId } = await setup();
    const table = await pricingRepo.publishPriceTable(db, {
      serviceId,
      sourceFilename: 'workflow.csv',
      uploadedBy: null,
      items: v1Items,
    });
    assert.equal(table.version, 1);
    assert.equal(table.status, 'active');
    assert.equal(table.item_count, 2);
    assert.equal(table.currency, 'INR');
    assert.deepEqual(
      (await pricingRepo.listPriceItems(db, table.id)).map((item) => [item.item_code, item.sort_order]),
      [['A', 1], ['B', 2]],
    );
  });

  it('supersedes the previous version and keeps its items for history', async () => {
    const { db, serviceId } = await setup();
    const first = await pricingRepo.publishPriceTable(db, { serviceId, sourceFilename: 'v1.csv', uploadedBy: null, items: v1Items });
    const second = await pricingRepo.publishPriceTable(db, {
      serviceId,
      sourceFilename: 'v2.csv',
      uploadedBy: null,
      items: [{ item_code: 'C', description: 'Retainer', unit: 'month', unit_price_paise: 4990000 }],
    });

    assert.equal(second.version, 2);
    assert.equal((await pricingRepo.activePriceTable(db, serviceId))?.id, second.id);
    assert.deepEqual(
      (await pricingRepo.listPriceTables(db, serviceId)).map((table) => [table.version, table.status]),
      [[2, 'active'], [1, 'superseded']],
    );
    assert.deepEqual((await pricingRepo.listPriceItems(db, first.id)).map((item) => item.item_code), ['A', 'B']);
  });

  it('rolls back completely when an item insert fails', async () => {
    const { db, serviceId } = await setup();
    const first = await pricingRepo.publishPriceTable(db, { serviceId, sourceFilename: 'v1.csv', uploadedBy: null, items: v1Items });

    await assert.rejects(
      pricingRepo.publishPriceTable(db, {
        serviceId,
        sourceFilename: 'broken.csv',
        uploadedBy: null,
        items: [
          { item_code: 'X', description: 'One', unit: 'each', unit_price_paise: 1 },
          { item_code: 'X', description: 'Duplicate', unit: 'each', unit_price_paise: 2 },
        ],
      }),
    );

    assert.equal((await pricingRepo.activePriceTable(db, serviceId))?.id, first.id);
    assert.equal((await pricingRepo.listPriceTables(db, serviceId)).length, 1);
  });

  it('rejects negative prices at the database level', async () => {
    const { db, serviceId } = await setup();
    await assert.rejects(
      pricingRepo.publishPriceTable(db, {
        serviceId,
        sourceFilename: 'bad.csv',
        uploadedBy: null,
        items: [{ item_code: 'N', description: 'Negative', unit: 'each', unit_price_paise: -1 }],
      }),
    );
  });
});
