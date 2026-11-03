const { fail } = require('./http');
const { audit, lockBrand } = require('./audit');
const defaultPresentation = {
  version: 1,
  categoryNavigation: 'horizontal',
  productCardDensity: 'comfortable',
  showImages: true,
  showDescriptions: true
};
const brandShape = b => ({id:b.id,name:b.name,slug:b.slug,logoUrl:b.logoUrl,primaryColor:b.primaryColor,currency:b.currency,timezone:b.timezone,presentation:{...defaultPresentation,...(b.presentation||{})}});
async function resolveMenu(db, assignmentId) {
  const a = await db.storeBrand.findUnique({where:{id:assignmentId},include:{store:{include:{org:true}},brand:{include:{org:true}},overrides:true}});
  if (!a || a.status !== 'active' || a.store.status !== 'active' || a.store.org.status !== 'active' || a.brand.status !== 'active' || a.brand.org.status !== 'active') fail(404, 'Active assignment not found.');
  const categories = await db.category.findMany({where:{brandId:a.brandId,isActive:true},orderBy:[{sortOrder:'asc'},{id:'asc'}],include:{parent:{select:{id:true,code:true,name:true}},products:{where:{brandId:a.brandId,isActive:true},orderBy:[{sortOrder:'asc'},{createdAt:'desc'},{id:'asc'}]}}});
  const overrides = new Map(a.overrides.map(o => [o.productId,o]));
  return {...brandShape(a.brand),storeBrandId:a.id,categories:categories.map(c=>({id:c.id,code:c.code,name:c.name,parentId:c.parentId,parent:c.parent,icon:c.icon,imageUrl:c.imageUrl,sortOrder:c.sortOrder,items:c.products.map(p=>{
    const o=overrides.get(p.id);
    const unavailable=new Set(o?.unavailableOptionIds||[]);
    return {id:p.id,name:p.name,description:p.description,ingredients:p.ingredients,imageUrl:p.imageUrl,priceAmount:String(o?.priceAmount ?? p.priceAmount),currency:p.currency,availability:o?.isSoldOut ? 'soldout':'available',sizes:(p.sizes||[]).map(size=>({...size,available:!unavailable.has(size.id)})),addOnGroups:(p.addOnGroups||[]).map(group=>({...group,options:group.options.map(option=>({...option,available:!unavailable.has(option.id)}))})),createdAt:p.createdAt.toISOString(),updatedAt:p.updatedAt.toISOString()};
  })}))};
}
async function publish(db, actor, brandId, storeIds) {
  return db.$transaction(async tx=>{
    await lockBrand(tx,brandId);
    const assignments=await tx.storeBrand.findMany({where:{brandId,status:'active',...(storeIds ? {storeId:{in:storeIds}}:{})},orderBy:{storeId:'asc'}});
    if (!assignments.length || (storeIds && assignments.length!==new Set(storeIds).size)) fail(404,'One or more assignments were not found.');
    const results=[];
    for (const a of assignments) {
      const snapshot=await resolveMenu(tx,a.id);
      const counter=await tx.storeBrand.update({where:{id:a.id},data:{nextVersion:{increment:1}}});
      const menu=await tx.menuVersion.create({data:{storeBrandId:a.id,version:counter.nextVersion,snapshot,publishedBy:actor?.id}});
      await tx.storeBrand.update({where:{id:a.id},data:{currentMenuVersionId:menu.id,unpublishedChanges:false}});
      await tx.store.update({where:{id:a.storeId},data:{revision:{increment:1}}});
      await audit(tx,actor,{brandId,orgId:(await tx.brand.findUnique({where:{id:brandId},select:{orgId:true}})).orgId,storeId:a.storeId},'MenuVersion',menu.id,'publish',{version:menu.version});
      results.push({storeId:a.storeId,version:menu.version});
    }
    return results;
  },{timeout:30000});
}
async function readPublishedMenu(db, storeId) {
  const store=await db.store.findUnique({where:{id:storeId},include:{org:true,assignments:{where:{status:'active',currentMenuVersionId:{not:null},brand:{status:'active',org:{status:'active'}}},orderBy:[{displayOrder:'asc'},{id:'asc'}],include:{currentMenu:true}}}});
  if(!store || store.status!=='active' || store.org.status!=='active') fail(401,'Store session is no longer valid.');
  return {schemaVersion:2,store:{id:store.id,name:store.name,orgId:store.orgId},revision:store.revision,brands:store.assignments.filter(a=>a.currentMenu && a.currentMenu.storeBrandId===a.id).map(a=>({...a.currentMenu.snapshot,menuVersion:a.currentMenu.version}))};
}
async function publishedMenu(db, storeId) {
  return db.$transaction
    ? db.$transaction(tx=>readPublishedMenu(tx,storeId),{isolationLevel:'RepeatableRead'})
    : readPublishedMenu(db,storeId);
}
module.exports={brandShape,resolveMenu,publish,publishedMenu,defaultPresentation};
