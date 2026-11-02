#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { publish } = require('../platform/menu');

const prisma = new PrismaClient();
const menuPath = path.join(__dirname, 'forsan-menu.json');
const addonCategory = 'ADD ONS';
const drinkSubcategories = new Set([
  'Hot Drinks',
  'Cold Drinks',
  'Blended Drinks',
  'Manual Brews'
]);
const foodSubcategories = new Set(['Burgers', 'Sandwiches & Croissants']);
const drinkAddonNames = new Set([
  'Vanilla Syrup',
  'Almond milk',
  'Soya Milk',
  'Oat Milk',
  'Coconut Milk',
  'Caramel Syrup',
  'Lactose Free',
  'Extra Sweet milk',
  'Whipped cream',
  'EXTRA SHOT'
]);
const foodAddonNames = new Set([
  'Cheese',
  'Bacon',
  'Fresh Avocado',
  'Chicken',
  'Turkey ham',
  'Extra omellete',
  'halloumi cheese'
]);

const categoryMappings = {
  'HOT DRINKS': { main: 'Drinks', subcategory: 'Hot Drinks' },
  'COLD DRINKS': { main: 'Drinks', subcategory: 'Cold Drinks' },
  'BOTTLED BEVERAGES': { main: 'Drinks', subcategory: 'Cold Drinks' },
  'FLAVOURED ICE AMERICANO': { main: 'Drinks', subcategory: 'Cold Drinks' },
  'BLENDED DRINKS': { main: 'Drinks', subcategory: 'Blended Drinks' },
  SMOOTHIES: { main: 'Drinks', subcategory: 'Smoothies' },
  'SPECIALITY COFFEE': { main: 'Speciality Coffee', subcategory: 'Manual Brews' },
  'ROASTED BEANS': { main: 'Beans', subcategory: 'Roasted Beans' },
  '250 Grms Roasted Beans Display': { main: 'Beans', subcategory: 'Roasted Beans' },
  'CO- FERMENTED COFFEE': { main: 'Beans', subcategory: 'Co-Fermented Beans' },
  BREAKFAST: { main: 'Food', subcategory: 'Breakfast' },
  PIZZA: { main: 'Food', subcategory: 'Pizza' },
  PASTA: { main: 'Food', subcategory: 'Pasta' },
  'MAIN COURSE': { main: 'Food', subcategory: 'Main Course' },
  APPETIZER: { main: 'Food', subcategory: 'Appetizers' },
  'KIDS MEAL': { main: 'Food', subcategory: 'Kids Meal' },
  'ADD ONS': { main: 'Extras', subcategory: 'Add-Ons' },
  'SINGLE ORIGIN ADD ONS': { main: 'Extras', subcategory: 'Single Origin Add-Ons' }
};

const emptySubcategories = [
  { main: 'Beans', subcategory: 'Green Beans' }
];

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

function productName(sourceName) {
  return productNameOverrides[sourceName] || sourceName;
}

function burgerSubcategory(itemName) {
  return /\b(burger|beef)\b/i.test(itemName) ? 'Burgers' : 'Sandwiches & Croissants';
}

function normalizeMenu(menu) {
  const normalized = [];
  for (const source of menu) {
    if (source.category === 'Burger_Sandwiches') {
      const groups = new Map();
      for (const item of source.items) {
        const subcategory = burgerSubcategory(item.name);
        const key = `Food / ${subcategory}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
      for (const [name, items] of groups) {
        normalized.push({
          sourceCategory: source.category,
          main: 'Food',
          subcategory: name.slice('Food / '.length),
          category: name,
          items
        });
      }
      continue;
    }

    const mapping = categoryMappings[source.category];
    if (!mapping) continue;
    normalized.push({
      sourceCategory: source.category,
      main: mapping.main,
      subcategory: mapping.subcategory,
      category: `${mapping.main} / ${mapping.subcategory}`,
      items: source.items
    });
  }

  for (const emptyCategory of emptySubcategories) {
    normalized.push({
      sourceCategory: null,
      main: emptyCategory.main,
      subcategory: emptyCategory.subcategory,
      category: `${emptyCategory.main} / ${emptyCategory.subcategory}`,
      items: []
    });
  }
  const merged = new Map();
  for (const category of normalized) {
    const existing = merged.get(category.category);
    if (existing) {
      existing.items.push(...category.items);
      existing.sourceCategories = [...new Set([...existing.sourceCategories, category.sourceCategory])];
    } else {
      merged.set(category.category, {
        ...category,
        sourceCategories: [category.sourceCategory]
      });
    }
  }
  return [...merged.values()];
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

function addonGroup(id, name, items) {
  return {
    id,
    name,
    selection: 'multiple',
    options: items.map(item => ({
      id: `addon-${slug(item.name)}`,
      name: productName(item.name),
      priceAmount: money(item.price)
    }))
  };
}

function addonGroups(addons, originAddons) {
  const drinkAddons = addons.filter(item => drinkAddonNames.has(item.name));
  const foodAddons = addons.filter(item => foodAddonNames.has(item.name));
  return {
    drinks: [
      addonGroup('drink-add-ons', 'Drink Add-ons', drinkAddons),
      addonGroup('single-origin-coffee', 'Single Origin Coffee', originAddons)
    ],
    food: [addonGroup('food-add-ons', 'Food Add-ons', foodAddons)]
  };
}

function productData(brand, category, item, groups) {
  const sizes = sizesFor(item);
  const addOnGroups = drinkSubcategories.has(category.subcategory)
    ? groups.drinks
    : foodSubcategories.has(category.subcategory)
      ? groups.food
      : [];
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
    addOnGroups
  };
}

function emptySummary() {
  return {
    categoriesCreated: 0,
    categoriesUpdated: 0,
    productsCreated: 0,
    productsUpdated: 0,
    categoriesRetired: 0,
    productsRetired: 0,
    addOnsAttached: 0,
    published: false,
    categoryBreakdown: []
  };
}

function categoryBreakdown(menu) {
  return menu.map(category => ({
    mainCategory: category.main,
    subcategory: category.subcategory,
    itemCount: category.items.length
  }));
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
  summary.categoryBreakdown = categoryBreakdown(menu);
  const existingCategories = await db.category.findMany({
    where: { brandId: targets.brand.id },
    select: { id: true, code: true, name: true }
  });
  const categoriesByCode = new Map(existingCategories.map(category => [category.code, category]));
  const sourceCategories = new Map();
  const addonItems = menu
    .filter(category => category.sourceCategories.includes(addonCategory))
    .flatMap(category => category.items);
  const originAddonItems = menu
    .filter(category => category.sourceCategories.includes('SINGLE ORIGIN ADD ONS'))
    .flatMap(category => category.items);
  const groups = addonGroups(addonItems, originAddonItems);

  for (const [sortOrder, source] of menu.entries()) {
    process.stderr.write(`Preparing category ${sortOrder + 1}/${menu.length}: ${source.category}\n`);
    const code = slug(source.category);
    const existing = categoriesByCode.get(code);
    const data = {
      brandId: targets.brand.id,
      code,
      name: source.category,
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
  const targetCategoryIds = categories.map(category => category.id);
  if (dryRun) {
    const existingProducts = await db.product.findMany({
      where: { brandId: targets.brand.id },
      select: { categoryId: true, name: true }
    });
    const productKeys = new Set(existingProducts.map(product => `${product.categoryId}:${product.name}`));
    for (const source of menu) {
      process.stderr.write(`Importing products: ${source.category}\n`);
      const category = sourceCategories.get(source.category);
      for (const item of source.items) {
        if (productKeys.has(`${category.id}:${productName(item.name)}`)) summary.productsUpdated += 1;
        else summary.productsCreated += 1;
        if (drinkSubcategories.has(source.subcategory) || foodSubcategories.has(source.subcategory)) summary.addOnsAttached += 1;
      }
    }
    summary.categoriesRetired = await db.category.count({
      where: { brandId: targets.brand.id, id: { notIn: targetCategoryIds } }
    });
    summary.productsRetired = await db.product.count({
      where: { brandId: targets.brand.id, categoryId: { notIn: targetCategoryIds }, isActive: true }
    });
    return summary;
  }

  for (const source of menu) {
    const category = sourceCategories.get(source.category);
    for (const [sortOrder, item] of source.items.entries()) {
      const name = productName(item.name);
      const data = productData(targets.brand, { ...category, subcategory: source.subcategory }, item, groups);
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
      if (drinkSubcategories.has(source.subcategory) || foodSubcategories.has(source.subcategory)) summary.addOnsAttached += 1;
    }
  }

  const retiredProducts = await db.product.updateMany({
    where: { brandId: targets.brand.id, categoryId: { notIn: targetCategoryIds }, isActive: true },
    data: { isActive: false }
  });
  const retiredCategories = await db.category.updateMany({
    where: { brandId: targets.brand.id, id: { notIn: targetCategoryIds }, isActive: true },
    data: { isActive: false }
  });
  summary.productsRetired = retiredProducts.count;
  summary.categoriesRetired = retiredCategories.count;

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

  const menu = normalizeMenu(loadMenu());
  const targets = await findTargets(prisma);
  const summary = await importMenu(prisma, targets, menu, dryRun);

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
