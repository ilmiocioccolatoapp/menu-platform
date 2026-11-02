#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { publish } = require('../platform/menu');

const prisma = new PrismaClient();
const menuPath = path.join(__dirname, 'forsan-menu.json');
const addonCategory = 'ADD ONS';
const addonTargetCategories = new Set([
  'HOT DRINKS',
  'COLD DRINKS',
  'BLENDED DRINKS',
  'SPECIALITY COFFEE',
  'FLAVOURED ICE AMERICANO'
]);

const categoryNameOverrides = {
  Burger_Sandwiches: 'Burger & Sandwiches',
  'FLAVOURED ICE AMERICANO': 'Flavored Ice Americano',
  'CO- FERMENTED COFFEE': 'Co-Fermented Coffee'
};

const productNameOverrides = {
  'Cripsy double chicken': 'Crispy double chicken',
  'PINEAPPLE JUCE': 'Pineapple Juice',
  'Vanila Frappe': 'Vanilla Frappe'
};

function slug(value) {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function money(value) {
  return Number(value).toFixed(2);
}

function loadMenu() {
  const parsed = JSON.parse(fs.readFileSync(menuPath, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`Menu data must be a non-empty array: ${menuPath}`);
  }
  for (const category of parsed) {
    if (!category || typeof category.category !== 'string' || !Array.isArray(category.items)) {
      throw new Error(`Invalid category in ${menuPath}`);
    }
    for (const item of category.items) {
      if (!item || typeof item.name !== 'string' || typeof item.price !== 'number') {
        throw new Error(`Invalid item in category ${category.category}`);
      }
      if (item.variants !== undefined && !Array.isArray(item.variants)) {
        throw new Error(`Invalid variants for ${item.name}`);
      }
    }
  }
  return parsed;
}

function categoryName(sourceName) {
  return categoryNameOverrides[sourceName] || sourceName;
}

function productName(sourceName) {
  return productNameOverrides[sourceName] || sourceName;
}

function sizesFor(item) {
  const variants = item.variants || [];
  if (variants.length <= 1) return [];
  return variants.map(variant => ({
    id: slug(variant.size),
    name: variant.size,
    priceAmount: money(variant.price)
  }));
}

function addonGroups(addons) {
  return [{
    id: 'add-ons',
    name: 'Add-ons',
    selection: 'multiple',
    options: addons.map(item => ({
      id: `addon-${slug(item.name)}`,
      name: productName(item.name),
      priceAmount: money(item.price)
    }))
  }];
}

function productData(brand, category, item, groups) {
  const sourceCategory = category.sourceName;
  const sizes = sizesFor(item);
  return {
    brandId: brand.id,
    categoryId: category.id,
    name: productName(item.name),
    legacyCategoryCode: category.code,
    imageUrl: '',
    description: '',
    ingredients: '',
    legacyPrice: `${brand.currency} ${money(item.price)}`,
    priceAmount: money(item.price),
    currency: brand.currency,
    isActive: true,
    sizes,
    addOnGroups: addonTargetCategories.has(sourceCategory) ? groups : []
  };
}

function emptySummary() {
  return {
    categoriesCreated: 0,
    categoriesUpdated: 0,
    productsCreated: 0,
    productsUpdated: 0,
    addOnsAttached: 0,
    published: false
  };
}

async function findTargets(db) {
  const brand = await db.brand.findFirst({
    where: {
      OR: [
        { name: 'Coffee Beans World' },
        { name: 'CBW' },
        { slug: 'coffee-beans-world' },
        { slug: 'cbw' }
      ]
    },
    select: { id: true, name: true, currency: true }
  });
  if (!brand) throw new Error('Brand "Coffee Beans World" (or existing alias "CBW") was not found.');

  const store = await db.store.findFirst({
    where: {
      OR: [
        { name: 'Al Forsan' },
        { name: 'CBW-Al Forsan' },
        { slug: 'al-forsan' },
        { slug: 'cbw-003' }
      ]
    },
    select: { id: true, name: true }
  });
  if (!store) throw new Error('Store "Al Forsan" (or existing alias "CBW-Al Forsan") was not found.');

  const assignment = await db.storeBrand.findUnique({
    where: { storeId_brandId: { storeId: store.id, brandId: brand.id } },
    select: { id: true, status: true }
  });
  if (!assignment || assignment.status !== 'active') {
    throw new Error('Coffee Beans World is not actively assigned to Al Forsan.');
  }
  return { brand, store, assignment };
}

async function importMenu(db, targets, menu, dryRun) {
  const summary = emptySummary();
  const existingCategories = await db.category.findMany({
    where: { brandId: targets.brand.id },
    select: { id: true, code: true, name: true }
  });
  const categoriesByCode = new Map(existingCategories.map(category => [category.code, category]));
  const sourceCategories = new Map();
  const addonItems = menu.find(category => category.category === addonCategory)?.items || [];
  const groups = addonGroups(addonItems);

  for (const [sortOrder, source] of menu.entries()) {
    const code = slug(source.category);
    const existing = categoriesByCode.get(code);
    const data = {
      brandId: targets.brand.id,
      code,
      name: categoryName(source.category),
      icon: '📦',
      sortOrder,
      isActive: true
    };
    let category = existing;
    if (existing) {
      summary.categoriesUpdated += 1;
      if (!dryRun) category = await db.category.update({ where: { id: existing.id }, data });
    } else {
      summary.categoriesCreated += 1;
      if (!dryRun) category = await db.category.create({ data });
    }
    sourceCategories.set(source.category, category || { id: `dry-run-${code}`, code });
  }

  const categories = [...sourceCategories.values()];
  if (dryRun) {
    const existingProducts = await db.product.findMany({
      where: { brandId: targets.brand.id },
      select: { categoryId: true, name: true }
    });
    const productKeys = new Set(existingProducts.map(product => `${product.categoryId}:${product.name}`));
    for (const source of menu) {
      const category = sourceCategories.get(source.category);
      for (const item of source.items) {
        if (productKeys.has(`${category.id}:${productName(item.name)}`)) summary.productsUpdated += 1;
        else summary.productsCreated += 1;
        if (addonTargetCategories.has(source.category)) summary.addOnsAttached += 1;
      }
    }
    return summary;
  }

  for (const source of menu) {
    const category = sourceCategories.get(source.category);
    for (const [sortOrder, item] of source.items.entries()) {
      const name = productName(item.name);
      const data = productData(targets.brand, { ...category, sourceName: source.category }, item, groups);
      const existing = await db.product.findFirst({
        where: { brandId: targets.brand.id, categoryId: category.id, name },
        select: { id: true }
      });
      if (existing) {
        await db.product.update({ where: { id: existing.id }, data: { ...data, sortOrder } });
        summary.productsUpdated += 1;
      } else {
        await db.product.create({ data: { ...data, sortOrder } });
        summary.productsCreated += 1;
      }
      if (addonTargetCategories.has(source.category)) summary.addOnsAttached += 1;
    }
  }

  await db.storeBrand.update({
    where: { id: targets.assignment.id },
    data: { unpublishedChanges: true }
  });
  return summary;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const shouldPublish = process.argv.includes('--publish');
  if (shouldPublish && dryRun) throw new Error('--dry-run and --publish cannot be used together.');

  const menu = loadMenu();
  const targets = await findTargets(prisma);
  const summary = dryRun
    ? await importMenu(prisma, targets, menu, true)
    : await prisma.$transaction(tx => importMenu(tx, targets, menu, false), { timeout: 120000 });

  if (shouldPublish) {
    await publish(prisma, null, targets.brand.id, [targets.store.id]);
    summary.published = true;
  }

  process.stdout.write(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'apply',
    brand: targets.brand.name,
    store: targets.store.name,
    ...summary
  }, null, 2) + '\n');
}

main()
  .catch(error => {
    process.stderr.write(`Forsan menu import failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
