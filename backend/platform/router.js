const express=require('express');
const crypto=require('crypto');
const qrcode=require('qrcode');
const cloudinary=require('cloudinary').v2;
const {wrap,fail,text,code,money,bool,order,timezone,imageUrl}=require('./http');
const {createAdminAuth,brandOpsScope,brandCatalogScope,platformAdminScope,brandWhere}=require('./auth');
const {hash,password,login,verifyPassword,loginWithQr,qrTokenHash,refresh,createStoreAuth}=require('./storeAuth');
const {resolveMenu,publish,publishedMenu}=require('./menu');
const {audit,lockBrand}=require('./audit');
const {createProvisioningClients}=require('./provisioning');
const {measure,timingMiddleware}=require('./timing');
const {normalizeSizes,normalizeAddOnGroups,normalizeUnavailableOptionIds}=require('./catalog-options');
const status=value=>{if(!['active','inactive'].includes(value))fail(400,'Status must be active or inactive.');return value;};
const organizationNameKey=name=>name.trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
function labelOrganizations(orgs){
 const counts=new Map();
 for(const org of orgs){const key=organizationNameKey(org.name);counts.set(key,(counts.get(key)||0)+1);}
 return orgs.map(org=>({...org,displayName:counts.get(organizationNameKey(org.name))>1?`${org.name} · ${org.id}`:org.name}));
}
const storeSelect={id:true,orgId:true,name:true,slug:true,address:true,phone:true,timezone:true,status:true,loginCode:true,revision:true,lastLoginAt:true};
const assignmentInclude={brand:{select:{id:true,name:true,orgId:true,slug:true}},store:{select:{id:true,name:true,orgId:true}},overrides:true};
const json=res=>value=>res.json({success:true,data:value});
function createRouter(db,verifyIdentity,authClients=createProvisioningClients()){
 cloudinary.config({cloud_name:process.env.CLOUDINARY_CLOUD_NAME,api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET});
 const router=express.Router(),admin=express.Router();
 const adminAuth=createAdminAuth(db,verifyIdentity),storeAuth=createStoreAuth(db);
 const org=async req=>brandOpsScope(db,req.admin,req.params.orgId);
 const brand=async req=>brandCatalogScope(db,req.admin,req.params.brandId);
 const assignment=async(req,tx=db)=>{
   await brand(req);
   const a=await tx.storeBrand.findUnique({where:{storeId_brandId:{storeId:req.params.storeId,brandId:req.params.brandId}}});
   if(!a)fail(404,'Assignment not found.');return a;
 };
 const brandWrite=async(req,fn,affectedStoreId)=>{const b=await brand(req);return db.$transaction(async tx=>{await lockBrand(tx,b.id);const result=await fn(tx,b);await tx.storeBrand.updateMany({where:{brandId:b.id,...(affectedStoreId?{storeId:affectedStoreId}:{})},data:{unpublishedChanges:true}});return result;});};
 const record=async(tx,req,b,entity,id,action,diff)=>audit(tx,req.admin,{orgId:b.orgId,brandId:b.id},entity,id,action,diff);
 router.post('/auth/store/login',wrap(async(req,res)=>{res.set('Cache-Control','no-store');const result=await login(db,req.body,req.ip);const menu=await publishedMenu(db,result.store.id);res.json({...result,brands:menu.brands.map(({id,name,slug,logoUrl,currency,menuVersion})=>({id,name,slug,logoUrl,currency,menuVersion}))});}));
 router.post('/auth/store/qr-login',wrap(async(req,res)=>{res.set('Cache-Control','no-store');const result=await loginWithQr(db,req.body);const menu=await publishedMenu(db,result.store.id);res.json({...result,brands:menu.brands.map(({id,name,slug,logoUrl,currency,menuVersion})=>({id,name,slug,logoUrl,currency,menuVersion}))});}));
 router.post('/auth/store/verify-password',wrap(async(req,res)=>{res.set('Cache-Control','no-store');await verifyPassword(db,req.body,req.ip);res.status(204).end();}));
 router.post('/auth/store/refresh',wrap(async(req,res)=>{res.set('Cache-Control','no-store');res.json(await refresh(db,req.body.refreshToken));}));
 router.post('/auth/store/logout',wrap(storeAuth),wrap(async(req,res)=>{await db.storeSession.update({where:{id:req.storeSession.id},data:{revokedAt:new Date()}});res.status(204).end();}));
 router.get('/menu',wrap(storeAuth),wrap(async(req,res)=>{
   if(req.query.storeId && req.query.storeId!==req.store.id)fail(403,'This session belongs to another store.');
   const envelope=await publishedMenu(db,req.store.id);
   if(req.query.brandId && !envelope.brands.some(b=>b.id===req.query.brandId))fail(403,'Brand is not assigned to this store.');
   const etag='"store:'+req.store.id+':rev:'+envelope.revision+'"';res.set('ETag',etag);
   if(req.get('If-None-Match')===etag)return res.status(304).end();
   res.json(envelope);
 }));
 async function legacy(req,res,categoriesOnly){
   const route=categoriesOnly?'categories':'products';
   const ip=req.ip||req.socket?.remoteAddress||'unknown';
   const userAgent=(req.get('User-Agent')||'').slice(0,512);
   let hit;
   try{hit=await db.legacyRouteHit.create({data:{route,ip,userAgent}});}catch{fail(503,'Legacy route monitoring is unavailable.');}
   console.info(JSON.stringify({event:'legacy_route_hit',route,ip,userAgent,at:hit.at.toISOString()}));
   const a=await db.storeBrand.findUnique({where:{id:process.env.LEGACY_ASSIGNMENT_ID || 'legacy-ilmio-main'},include:{currentMenu:true,store:true,brand:true}});
   if(!a || a.status!=='active' || a.store.status!=='active' || a.brand.status!=='active' || !a.currentMenu)fail(503,'The original menu has not been published.');
   if(process.env.LEGACY_CATALOG_ENABLED==='false')fail(410,'Update the tablet app to sign in.');
   const categories=a.currentMenu.snapshot.categories||[];
   const data=categoriesOnly?categories.map(c=>({_id:c.id,dbId:c.id,id:c.code,name:c.name,icon:c.icon,order:c.sortOrder,count:c.items.length})):categories.flatMap(c=>c.items.map(p=>({_id:p.id,dbId:p.id,title:p.name,category:c.code,image:p.imageUrl,description:p.description,ingredients:p.ingredients,price:p.legacyPrice || (p.currency==='EUR'?'€':p.currency+' ')+Number(p.priceAmount).toFixed(2),available:p.availability!=='soldout',sizes:p.sizes||[],addOnGroups:p.addOnGroups||[],createdAt:p.createdAt,updatedAt:p.updatedAt}))).filter(p=>p.available);
   res.set('Cache-Control','no-store').json({success:true,count:data.length,data});
 }
 router.get('/categories',wrap((req,res)=>legacy(req,res,true)));
 router.get('/products/available',wrap((req,res)=>legacy(req,res,false)));
 // Old write routes cannot bypass the new membership and audit paths.
 router.all(['/products','/products/:id','/products/:id/toggle','/categories/:id'],wrap(adminAuth),(req,res)=>res.status(410).json({success:false,error:'Use the brand-scoped administration API.'}));
 router.use('/admin',admin);
 admin.use(timingMiddleware);
 admin.use(wrap(adminAuth));
 async function adminData(req){
   const orgMembershipIds=req.admin.orgMemberships.map(m=>m.orgId);
   const brandMembershipIds=req.admin.brandMemberships.map(m=>m.brandId);
   const orgWhere=req.admin.isPlatformAdmin?{}:{
     status:'active',
     OR:[
       {id:{in:orgMembershipIds}},
       {brands:{some:{id:{in:brandMembershipIds}}}}
     ]
   };
   const [brands,organizationRows]=await Promise.all([
     measure(req,'brandFindManyMs',()=>db.brand.findMany({
       where:brandWhere(req.admin),
       select:{id:true,orgId:true,slug:true,name:true,logoUrl:true,primaryColor:true,currency:true,timezone:true,status:true,createdAt:true},
       orderBy:{name:'asc'}
     })),
     measure(req,'organizationFindManyMs',()=>db.organization.findMany({
       where:orgWhere,
       select:{id:true,name:true,status:true},
       orderBy:[{name:'asc'},{id:'asc'}]
     }))
   ]);
   const orgs=labelOrganizations(organizationRows);
   return {...req.adminUser,name:req.admin.name,isPlatformAdmin:req.admin.isPlatformAdmin,orgMemberships:req.admin.orgMemberships,brandMemberships:req.admin.brandMemberships,orgs,brands};
 }
 async function dashboardData(req){
   const now=new Date(),onlineSince=new Date(now.getTime()-10*60*1000);
   const stores=await measure(req,'storeFindManyMs',()=>db.store.findMany({
     select:{
       id:true,orgId:true,name:true,status:true,loginCode:true,passwordHash:true,
       assignments:{where:{status:'active'},select:{id:true,status:true,brand:{select:{id:true,name:true}}}},
       sessions:{where:{revokedAt:null,expiresAt:{gt:now},lastSeenAt:{gte:onlineSince}},select:{id:true,deviceLabel:true,lastSeenAt:true},orderBy:{lastSeenAt:'desc'}}
     },
     orderBy:{name:'asc'}
   }));
   return {asOf:now.toISOString(),onlineWindowMinutes:10,stores:stores.map(({sessions,passwordHash,...store})=>({...store,passwordConfigured:passwordHash?.startsWith('$argon2id$')??false,devices:sessions}))};
 }
 async function me(req,res){json(res)(await adminData(req));}
 admin.get('/me',wrap(me));
 admin.get('/bootstrap',wrap(async(req,res)=>{
   const [user,dashboard]=await Promise.all([
     adminData(req),
     req.admin.isPlatformAdmin?dashboardData(req):Promise.resolve(null)
   ]);
   json(res)({user,dashboard});
 }));
 router.get('/auth/me',wrap(adminAuth),wrap(me));
 admin.get('/orgs',wrap(async(req,res)=>{const orgIds=req.admin.orgMemberships.map(m=>m.orgId);json(res)(labelOrganizations(await db.organization.findMany({where:req.admin.isPlatformAdmin?{}:{id:{in:orgIds},status:'active'},orderBy:[{name:'asc'},{id:'asc'}]})));}));
 admin.get('/stores',wrap(async(req,res)=>{
   platformAdminScope(req.admin);
   const stores=await db.store.findMany({select:{...storeSelect,passwordHash:true,org:{select:{id:true,name:true}},assignments:{include:{brand:{select:{id:true,name:true,orgId:true}}}}},orderBy:{name:'asc'}});
   const orgLabels=new Map(labelOrganizations([...new Map(stores.map(store=>[store.org.id,store.org])).values()]).map(org=>[org.id,org.displayName]));
   json(res)(stores.map(({passwordHash,org,...store})=>({...store,ownerName:org.name,ownerDisplayName:orgLabels.get(org.id)||org.name,passwordConfigured:passwordHash?.startsWith('$argon2id$')??false})));
 }));
 admin.get('/dashboard',wrap(async(req,res)=>{platformAdminScope(req.admin);json(res)(await dashboardData(req));}));
 admin.post('/orgs',wrap(async(req,res)=>{platformAdminScope(req.admin);const name=text(req.body.name,'Organization name');const data=await db.$transaction(async tx=>{const key=organizationNameKey(name);await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`organization-name:${key}`}))`;const existing=await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE lower(regexp_replace(trim("name"), '[[:space:]]+', ' ', 'g')) = ${key} LIMIT 1`;if(existing.length)fail(409,'An organization with this name already exists. Select it or merge the duplicate organizations first.');const o=await tx.organization.create({data:{name}});await audit(tx,req.admin,{orgId:o.id},'Organization',o.id,'create');return o;});res.status(201).json({success:true,data:{...data,displayName:data.name}});}));
 admin.put('/orgs/:orgId',wrap(async(req,res)=>{await org(req);const data=await db.$transaction(async tx=>{const o=await tx.organization.update({where:{id:req.params.orgId},data:{...(req.body.name!==undefined?{name:text(req.body.name,'Organization name')}:{}),...(req.body.status!==undefined?{status:status(req.body.status)}:{})}});if(req.body.status!==undefined){await tx.store.updateMany({where:{OR:[{orgId:o.id},{assignments:{some:{brand:{orgId:o.id}}}}]},data:{revision:{increment:1}}});}await audit(tx,req.admin,{orgId:o.id},'Organization',o.id,'update',{status:o.status});return o;});json(res)(data);}));
 admin.get('/brands',wrap(async(req,res)=>json(res)(await db.brand.findMany({where:brandWhere(req.admin),orderBy:{name:'asc'}}))));
 admin.post('/brands',wrap(async(req,res)=>{
   platformAdminScope(req.admin);
   const name=text(req.body.name,'Brand name');
   const slug=code(req.body.slug,'Brand slug');
   const data=await db.$transaction(async tx=>{
     let owner;
     if(req.body.orgId!==undefined){
       owner=await tx.organization.findUnique({where:{id:text(req.body.orgId,'Organization')}});
       if(!owner||owner.status!=='active')fail(404,'Organization not found.');
     }else{
       owner=await tx.organization.create({data:{name}});
     }
     const created=await tx.brand.create({data:{
       orgId:owner.id,
       name,
       slug,
       currency:currency(req.body.currency||'AED'),
       timezone:timezone(req.body.timezone||'Asia/Dubai')
     }});
     await audit(tx,req.admin,{orgId:owner.id,brandId:created.id},'Brand',created.id,'create');
     return created;
   });
   res.status(201).json({success:true,data});
 }));
 async function platformBrand(req){platformAdminScope(req.admin);const b=await db.brand.findUnique({where:{id:req.params.brandId}});if(!b)fail(404,'Brand not found.');return b;}
 admin.post('/brands/:brandId/stores',wrap(async(req,res)=>{
   const b=await platformBrand(req);
   const passwordHash=await hash(password(req.body.password));
   const result=await db.$transaction(async tx=>{
     await lockBrand(tx,b.id);
     const owner=await tx.organization.findUnique({where:{id:b.orgId}});
     if(!owner||owner.status!=='active')fail(404,'Brand owner organization not found.');
     const s=await tx.store.create({data:{
       orgId:b.orgId,
       name:text(req.body.name,'Store name'),
       slug:code(req.body.slug,'Store slug'),
       loginCode:code(req.body.loginCode,'Store login code'),
       passwordHash,
       timezone:timezone(req.body.timezone||'Asia/Dubai'),
       address:req.body.address?text(req.body.address,'Address',500):null
     },select:storeSelect});
     const a=await tx.storeBrand.create({data:{storeId:s.id,brandId:b.id,approvedBy:req.admin.id}});
     await tx.store.update({where:{id:s.id},data:{revision:{increment:1}}});
     await audit(tx,req.admin,{orgId:b.orgId,storeId:s.id},'Store',s.id,'create',{brandId:b.id});
     await record(tx,req,b,'StoreBrand',a.id,'approve-assignment');
     return {...s,passwordConfigured:true,ownerName:owner.name,assignment:a};
   });
   res.status(201).json({success:true,data:result});
 }));
 admin.get('/brands/:brandId/admins',wrap(async(req,res)=>{const b=await platformBrand(req);json(res)(await db.brandMembership.findMany({where:{brandId:b.id},include:{profile:{select:{id:true,email:true,name:true,status:true}}},orderBy:{createdAt:'asc'}}));}));
 admin.post('/brands/:brandId/admins',wrap(async(req,res)=>{
   const b=await platformBrand(req);
   if(Object.keys(req.body||{}).some(key=>/password/i.test(key)))fail(400,'Passwords are never accepted by the invitation endpoint.');
   const email=text(req.body.email,'Email',200).toLowerCase();if(!/^[^@\s]+@[^@\s]+[.][^@\s]+$/.test(email))fail(400,'Enter a valid administrator email.');
   const name=req.body.name===undefined?undefined:text(req.body.name,'Administrator name',120);
   let profile=await db.adminProfile.findUnique({where:{email}});
   if(profile&&profile.status!=='active')fail(409,'This administrator profile is inactive.');
   if(profile&&await db.brandMembership.findUnique({where:{profileId_brandId:{profileId:profile.id,brandId:b.id}}}))fail(409,'This email already has brand administrator access.');
   let user=await authClients.findUserByEmail(email);
   if(profile?.supabaseUserId&&user&&profile.supabaseUserId!==user.id)fail(409,'This email is linked to another sign-in identity.');
   if(profile?.supabaseUserId&&!user)fail(409,'The existing sign-in identity could not be found.');
   let inviteSent=false;
   if(!user){user=await authClients.inviteUserByEmail(email,name);inviteSent=true;}
   else if(!user.emailConfirmed){await authClients.sendSetupEmail(email,false);inviteSent=true;}
   const result=await db.$transaction(async tx=>{
     const current=await tx.adminProfile.findUnique({where:{email}});
     if(current?.supabaseUserId&&current.supabaseUserId!==user.id)fail(409,'This email is linked to another sign-in identity.');
     const saved=await tx.adminProfile.upsert({where:{email},create:{email,supabaseUserId:user.id,name:name||null},update:{supabaseUserId:user.id,...(name?{name}:{})}});
     const membership=await tx.brandMembership.create({data:{profileId:saved.id,brandId:b.id},include:{profile:{select:{id:true,email:true,name:true,status:true}}}});
     await audit(tx,req.admin,{orgId:b.orgId,brandId:b.id},'BrandMembership',membership.id,'brand_admin.provisioned',{inviteSent});
     return membership;
   });
   res.status(201).json({success:true,data:{membership:result,user:{id:user.id,email},inviteSent}});
 }));
 admin.delete('/brands/:brandId/admins/:membershipId',wrap(async(req,res)=>{const b=await platformBrand(req);await db.$transaction(async tx=>{const m=await tx.brandMembership.findFirst({where:{id:req.params.membershipId,brandId:b.id}});if(!m)fail(404,'Brand administrator membership not found.');await tx.brandMembership.delete({where:{id:m.id}});await audit(tx,req.admin,{orgId:b.orgId,brandId:b.id},'BrandMembership',m.id,'brand_admin.removed');});res.status(204).end();}));
 admin.post('/brands/:brandId/admins/:membershipId/resend-invite',wrap(async(req,res)=>{const b=await platformBrand(req);const m=await db.brandMembership.findFirst({where:{id:req.params.membershipId,brandId:b.id},include:{profile:true}});if(!m)fail(404,'Brand administrator membership not found.');const user=await authClients.findUserByEmail(m.profile.email);if(!user||user.id!==m.profile.supabaseUserId)fail(409,'The administrator sign-in identity could not be found.');await authClients.sendSetupEmail(m.profile.email,user.emailConfirmed);await db.$transaction(async tx=>audit(tx,req.admin,{orgId:b.orgId,brandId:b.id},'BrandMembership',m.id,'brand_admin.invite_resent'));res.status(204).end();}));
 function currency(value){if(!['AED','EUR','USD','GBP'].includes(value))fail(400,'Supported v1 currencies: AED, EUR, USD, GBP.');return value;}
 admin.get('/brands/:brandId/settings',wrap(async(req,res)=>json(res)(await brand(req))));
 admin.put('/brands/:brandId/settings',wrap(async(req,res)=>json(res)(await brandWrite(req,async(tx,b)=>{
   const data={};
   for(const field of ['name','slug','logoUrl','primaryColor','currency','timezone','status'])if(req.body[field]!==undefined){
    const v=req.body[field];data[field]=field==='name'?text(v,'Brand name'):field==='slug'?code(v,'Brand slug'):field==='logoUrl'?imageUrl(v):field==='currency'?currency(v):field==='timezone'?timezone(v):field==='status'?status(v):(/^#[0-9a-f]{6}$/i.test(v)?v:fail(400,'Color must be a six-digit hex color.'));
   }
   if(!req.admin.isPlatformAdmin&&data.slug!==undefined&&data.slug!==b.slug)fail(403,'Only a platform administrator can change a brand code.');
   if(data.currency && data.currency!==b.currency && await tx.product.count({where:{brandId:b.id}}))fail(409,'Currency cannot change while the brand has products. Create a separate catalog or migrate amounts explicitly.');
   const updated=await tx.brand.update({where:{id:b.id},data});
   if(data.status!==undefined)await tx.store.updateMany({where:{assignments:{some:{brandId:b.id}}},data:{revision:{increment:1}}});
   await record(tx,req,b,'Brand',b.id,'update',data);return updated;
 }))));
 admin.delete('/brands/:brandId',wrap(async(req,res)=>{
   const b=await platformBrand(req);
   await db.$transaction(async tx=>{
     await lockBrand(tx,b.id);
     const counts={
       activeAssignments:await tx.storeBrand.count({where:{brandId:b.id,status:'active'}}),
       assignments:await tx.storeBrand.count({where:{brandId:b.id}}),
       products:await tx.product.count({where:{brandId:b.id}}),
       categories:await tx.category.count({where:{brandId:b.id}}),
       administrators:await tx.brandMembership.count({where:{brandId:b.id}}),
       assets:await tx.asset.count({where:{brandId:b.id}})
     };
     if(counts.activeAssignments)fail(400,'Remove active store assignments before deleting this brand.');
     if(counts.products)fail(400,'Remove or migrate this brand’s products before deleting it.');
     if(counts.assignments)fail(400,'Remove all store assignments before deleting this brand.');
     if(counts.categories||counts.administrators||counts.assets)fail(400,'Remove this brand’s categories, administrators, and assets before deleting it.');
     await audit(tx,req.admin,{orgId:b.orgId,brandId:b.id},'Brand',b.id,'delete');
     await tx.brand.delete({where:{id:b.id}});
   });
   res.status(204).end();
 }));
 admin.get('/orgs/:orgId/stores',wrap(async(req,res)=>{
   await org(req);
   const stores=await db.store.findMany({where:{orgId:req.params.orgId},select:{...storeSelect,passwordHash:true,assignments:{include:{brand:{select:{id:true,name:true,orgId:true}}}}},orderBy:{name:'asc'}});
   json(res)(stores.map(({passwordHash,...store})=>({...store,passwordConfigured:passwordHash?.startsWith('$argon2id$')??false})));
 }));
 admin.post('/orgs/:orgId/stores',wrap(async(req,res)=>{
   await org(req);const passwordHash=await hash(password(req.body.password));
   const result=await db.$transaction(async tx=>{const s=await tx.store.create({data:{orgId:req.params.orgId,name:text(req.body.name,'Store name'),slug:code(req.body.slug,'Store slug'),loginCode:code(req.body.loginCode,'Store login code'),passwordHash,timezone:timezone(req.body.timezone||'Asia/Dubai'),address:req.body.address?text(req.body.address,'Address',500):null},select:storeSelect});await audit(tx,req.admin,{orgId:s.orgId,storeId:s.id},'Store',s.id,'create');return {...s,passwordConfigured:true};});res.status(201).json({success:true,data:result});
 }));
 async function ownedStore(req){await org(req);const s=await db.store.findFirst({where:{id:req.params.storeId,orgId:req.params.orgId}});if(!s)fail(404,'Store not found.');return s;}
 admin.delete('/orgs/:orgId/stores/:storeId',wrap(async(req,res)=>{
   const store=await ownedStore(req);
   await db.$transaction(async tx=>{
     const locked=await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${store.id} FOR UPDATE`;
     if(!locked.length)fail(404,'Store not found.');
     const assignments=await tx.storeBrand.findMany({
       where:{storeId:store.id},
       select:{id:true,_count:{select:{menus:true}}}
     });
     if(assignments.some(assignment=>assignment._count.menus>0)){
       fail(409,'This store has published menu history and cannot be permanently deleted. Deactivate the store to preserve that history.');
     }
     const devices=await tx.storeSession.deleteMany({where:{storeId:store.id}});
     await tx.storeBrand.deleteMany({where:{storeId:store.id}});
     await tx.store.delete({where:{id:store.id}});
     await audit(tx,req.admin,{orgId:store.orgId,storeId:store.id},'Store',store.id,'delete',{
       removedAssignments:assignments.length,
       removedDeviceSessions:devices.count
     });
   });
   res.status(204).end();
 }));
 admin.put('/orgs/:orgId/stores/:storeId',wrap(async(req,res)=>{const s=await ownedStore(req);const data={};for(const f of ['name','slug','loginCode','timezone','address','phone','status'])if(req.body[f]!==undefined)data[f]=f==='status'?status(req.body[f]):f==='timezone'?timezone(req.body[f]):['slug','loginCode'].includes(f)?code(req.body[f],f):text(req.body[f],f,500);if(data.status && data.status!==s.status)data.tokenVersion={increment:1};data.revision={increment:1};json(res)(await db.$transaction(async tx=>{const result=await tx.store.update({where:{id:s.id},data,select:storeSelect});await audit(tx,req.admin,{orgId:s.orgId,storeId:s.id},'Store',s.id,'update',{fields:Object.keys(data)});return result;}));}));
 admin.post('/orgs/:orgId/stores/:storeId/password',wrap(async(req,res)=>{
   const s=await ownedStore(req),passwordHash=await hash(password(req.body.newPassword));
   const token=crypto.randomBytes(32).toString('base64url'),tokenHash=qrTokenHash(token),expiresAt=new Date(Date.now()+5*60*1000);
   const result=await db.$transaction(async tx=>{
     const [locked]=await tx.$queryRaw`SELECT "loginCode" FROM "Store" WHERE "id" = ${s.id} FOR UPDATE`;
     if(!locked)fail(404,'Store not found.');
     const qrDataUrl=await qrcode.toDataURL(JSON.stringify({id:locked.loginCode,token}),{width:400,margin:2,errorCorrectionLevel:'M'});
     await tx.storeLoginQrToken.deleteMany({where:{storeId:s.id,consumedAt:null}});
     await tx.store.update({where:{id:s.id},data:{passwordHash,tokenVersion:{increment:1},failedLogins:0,lockedUntil:null}});
     await tx.storeLoginQrToken.create({data:{storeId:s.id,tokenHash,expiresAt}});
     await audit(tx,req.admin,{orgId:s.orgId,storeId:s.id},'Store',s.id,'reset-password');
     return {qrDataUrl,qrExpiresAt:expiresAt.toISOString()};
   });
   res.json({success:true,data:result});
 }));
 admin.post('/orgs/:orgId/stores/:storeId/revoke-devices',wrap(async(req,res)=>{const s=await ownedStore(req);await db.$transaction(async tx=>{await tx.store.update({where:{id:s.id},data:{tokenVersion:{increment:1}}});await tx.storeSession.updateMany({where:{storeId:s.id,revokedAt:null},data:{revokedAt:new Date()}});await audit(tx,req.admin,{orgId:s.orgId,storeId:s.id},'Store',s.id,'revoke-devices');});res.status(204).end();}));
 admin.get('/orgs/:orgId/stores/:storeId/sessions',wrap(async(req,res)=>{const s=await ownedStore(req);json(res)(await db.storeSession.findMany({where:{storeId:s.id},select:{id:true,deviceLabel:true,expiresAt:true,revokedAt:true,lastSeenAt:true,createdAt:true},orderBy:{createdAt:'desc'}}));}));
 admin.post('/orgs/:orgId/stores/:storeId/sessions/:sessionId/revoke',wrap(async(req,res)=>{const s=await ownedStore(req);await db.$transaction(async tx=>{const session=await tx.storeSession.findFirst({where:{id:req.params.sessionId,storeId:s.id}});if(!session)fail(404,'Session not found.');await tx.storeSession.update({where:{id:session.id},data:{revokedAt:new Date()}});await audit(tx,req.admin,{orgId:s.orgId,storeId:s.id},'StoreSession',session.id,'revoke');});res.status(204).end();}));
 admin.get('/orgs/:orgId/brand-assignments',wrap(async(req,res)=>{await org(req);json(res)(await db.storeBrand.findMany({where:{store:{orgId:req.params.orgId}},include:{brand:{select:{id:true,name:true,orgId:true}},store:{select:{id:true,name:true}}}}));}));
 admin.post('/orgs/:orgId/brand-assignments',wrap(async(req,res)=>{
   await org(req);
   const s=await db.store.findFirst({where:{id:req.body.storeId,orgId:req.params.orgId}});
   const b=await db.brand.findUnique({where:{id:req.body.brandId}});
   if(!s||!b)fail(404,'Store or brand not found.');
   if(s.orgId!==b.orgId && !req.admin.isPlatformAdmin)fail(403,'Only the platform Super Admin can approve a cross-owner assignment.');
   const result=await db.$transaction(async tx=>{await lockBrand(tx,b.id);const a=await tx.storeBrand.upsert({where:{storeId_brandId:{storeId:s.id,brandId:b.id}},create:{storeId:s.id,brandId:b.id,approvedBy:req.admin.id},update:{status:'active',approvedBy:req.admin.id,unpublishedChanges:true}});await tx.store.update({where:{id:s.id},data:{revision:{increment:1}}});await audit(tx,req.admin,{orgId:s.orgId,brandId:b.id,storeId:s.id},'StoreBrand',a.id,'approve-assignment',{crossOwner:s.orgId!==b.orgId});return a;});res.status(201).json({success:true,data:result});
 }));
 admin.put('/orgs/:orgId/brand-assignments/:assignmentId',wrap(async(req,res)=>{await org(req);const a=await db.storeBrand.findFirst({where:{id:req.params.assignmentId,store:{orgId:req.params.orgId}},include:{store:true,brand:true}});if(!a)fail(404,'Assignment not found.');if(req.body.status==='active' && a.store.orgId!==a.brand.orgId && !req.admin.isPlatformAdmin)fail(403,'Cross-owner activation requires the platform Super Admin.');const data={unpublishedChanges:true};if(req.body.status!==undefined)data.status=status(req.body.status);if(req.body.displayOrder!==undefined)data.displayOrder=order(req.body.displayOrder);json(res)(await db.$transaction(async tx=>{await lockBrand(tx,a.brandId);const result=await tx.storeBrand.update({where:{id:a.id},data});await tx.store.update({where:{id:a.storeId},data:{revision:{increment:1}}});await audit(tx,req.admin,{orgId:a.store.orgId,brandId:a.brandId,storeId:a.storeId},'StoreBrand',a.id,'update',data);return result;}));}));
 admin.delete('/orgs/:orgId/brand-assignments/:assignmentId',wrap(async(req,res)=>{await org(req);const a=await db.storeBrand.findFirst({where:{id:req.params.assignmentId,store:{orgId:req.params.orgId}}});if(!a)fail(404,'Assignment not found.');await db.$transaction(async tx=>{await lockBrand(tx,a.brandId);await tx.storeBrand.update({where:{id:a.id},data:{status:'inactive',unpublishedChanges:true}});await tx.store.update({where:{id:a.storeId},data:{revision:{increment:1}}});await audit(tx,req.admin,{orgId:req.params.orgId,brandId:a.brandId,storeId:a.storeId},'StoreBrand',a.id,'detach');});res.status(204).end();}));
 admin.get('/brands/:brandId/stores',wrap(async(req,res)=>{await brand(req);json(res)(await db.storeBrand.findMany({where:{brandId:req.params.brandId},include:{store:{select:{id:true,name:true,orgId:true,status:true}},overrides:true},orderBy:{storeId:'asc'}}));}));
 admin.get('/brands/:brandId/categories',wrap(async(req,res)=>{await brand(req);json(res)(await db.category.findMany({where:{brandId:req.params.brandId},include:{parent:{select:{id:true,code:true,name:true}},_count:{select:{products:true}}},orderBy:[{sortOrder:'asc'},{id:'asc'}]}));}));
 async function categoryData(body,partial=false,tx,brandId,current){const d={};if(!partial || body.code!==undefined)d.code=code(body.code,'Category code');if(!partial || body.name!==undefined)d.name=text(body.name,'Category name',50);if(body.icon!==undefined)d.icon=text(body.icon,'Category icon',20);if(body.sortOrder!==undefined)d.sortOrder=order(body.sortOrder);if(body.isActive!==undefined)d.isActive=bool(body.isActive,'Active');if(body.imageUrl!==undefined)d.imageUrl=imageUrl(body.imageUrl);if(body.parentId!==undefined){if(body.parentId===null||body.parentId==='')d.parentId=null;else{const parent=await tx.category.findFirst({where:{id:String(body.parentId),brandId:brandId},select:{id:true,parentId:true}});if(!parent)fail(400,'Parent category must belong to this brand.');if(parent.parentId)fail(400,'Only main categories can have subcategories.');if(current&&parent.id===current.id)fail(400,'A category cannot be its own parent.');d.parentId=parent.id;}}return d;}
 admin.post('/brands/:brandId/categories',wrap(async(req,res)=>res.status(201).json({success:true,data:await brandWrite(req,async(tx,b)=>{const data=await categoryData(req.body,false,tx,b.id);const c=await tx.category.create({data:{...data,brandId:b.id}});await record(tx,req,b,'Category',c.id,'create');return c;})})));
 admin.put('/brands/:brandId/categories/:id',wrap(async(req,res)=>json(res)(await brandWrite(req,async(tx,b)=>{const c=await tx.category.findFirst({where:{id:req.params.id,brandId:b.id}});if(!c)fail(404,'Category not found.');const data=await categoryData(req.body,true,tx,b.id,c);const result=await tx.category.update({where:{id:c.id},data});if(data.code)await tx.product.updateMany({where:{brandId:b.id,categoryId:c.id},data:{legacyCategoryCode:data.code}});await record(tx,req,b,'Category',c.id,'update',data);return result;}))));
 admin.delete('/brands/:brandId/categories/:id',wrap(async(req,res)=>{await brandWrite(req,async(tx,b)=>{const c=await tx.category.findFirst({where:{id:req.params.id,brandId:b.id}});if(!c)fail(404,'Category not found.');if(await tx.product.count({where:{brandId:b.id,categoryId:c.id}}))fail(409,'Reassign or remove products before deleting their category.');if(await tx.category.count({where:{brandId:b.id,parentId:c.id}}))fail(409,'Reassign or remove subcategories before deleting their main category.');await tx.category.delete({where:{id:c.id}});await record(tx,req,b,'Category',c.id,'delete');});res.status(204).end();}));
 admin.get('/brands/:brandId/items',wrap(async(req,res)=>{await brand(req);json(res)(await db.product.findMany({where:{brandId:req.params.brandId},include:{category:true},orderBy:[{sortOrder:'asc'},{createdAt:'desc'},{id:'asc'}]}));}));
 async function productData(tx,b,body,current){
   const d={};
   if(!current || body.name!==undefined)d.name=text(body.name,'Product name',100);
   if(!current || body.categoryId!==undefined || body.categoryCode!==undefined){const c=await tx.category.findFirst({where:{brandId:b.id,...(body.categoryId?{id:String(body.categoryId)}:{code:String(body.categoryCode||'')})}});if(!c)fail(400,'Select a category belonging to this brand.');d.categoryId=c.id;d.legacyCategoryCode=c.code;}
   for(const f of ['description','ingredients'])if(!current || body[f]!==undefined)d[f]=typeof body[f]==='string'?body[f].trim().slice(0,f==='description'?500:2000):'';
   if(!current || body.priceAmount!==undefined){d.priceAmount=money(body.priceAmount);d.currency=b.currency;d.legacyPrice=(b.currency==='EUR'?'€':b.currency+' ')+d.priceAmount;}
   if(body.currency!==undefined && body.currency!==b.currency)fail(400,'Product currency must match its brand.');
   if(!current || body.imageUrl!==undefined)d.imageUrl=imageUrl(body.imageUrl)||'';
   if(body.imagePublicId!==undefined){if(body.imagePublicId!==null){const asset=await tx.asset.findFirst({where:{brandId:b.id,publicId:body.imagePublicId}});if(!asset && body.imagePublicId!==current?.imagePublicId)fail(400,'Image must be uploaded for this brand.');}d.imagePublicId=body.imagePublicId;}
   if(body.isActive!==undefined)d.isActive=bool(body.isActive,'Active');
   if(body.sortOrder!==undefined)d.sortOrder=order(body.sortOrder);
   const optionIds=new Set();
   const sizes=normalizeSizes(body.sizes??current?.sizes??[],optionIds);
   const addOnGroups=normalizeAddOnGroups(body.addOnGroups??current?.addOnGroups??[],optionIds);
   if(!current || body.sizes!==undefined)d.sizes=sizes;
   if(!current || body.addOnGroups!==undefined)d.addOnGroups=addOnGroups;
   if(sizes.length){
     const lowestPrice=sizes.reduce((lowest,size)=>Number(size.priceAmount)<Number(lowest.priceAmount)?size:lowest);
     d.priceAmount=lowestPrice.priceAmount;
     d.currency=b.currency;
     d.legacyPrice=(b.currency==='EUR'?'€':b.currency+' ')+d.priceAmount;
   }
   return d;
 }
 admin.post('/brands/:brandId/items',wrap(async(req,res)=>res.status(201).json({success:true,data:await brandWrite(req,async(tx,b)=>{const p=await tx.product.create({data:{...await productData(tx,b,req.body),brandId:b.id},include:{category:true}});await record(tx,req,b,'Product',p.id,'create');return p;})})));
 admin.put('/brands/:brandId/items/:id',wrap(async(req,res)=>json(res)(await brandWrite(req,async(tx,b)=>{const p=await tx.product.findFirst({where:{id:req.params.id,brandId:b.id}});if(!p)fail(404,'Product not found.');const data=await productData(tx,b,req.body,p);const result=await tx.product.update({where:{id:p.id},data,include:{category:true}});await record(tx,req,b,'Product',p.id,'update',{fields:Object.keys(data)});return result;}))));
 admin.delete('/brands/:brandId/items/:id',wrap(async(req,res)=>{await brandWrite(req,async(tx,b)=>{const p=await tx.product.findFirst({where:{id:req.params.id,brandId:b.id}});if(!p)fail(404,'Product not found.');await tx.product.delete({where:{id:p.id}});await record(tx,req,b,'Product',p.id,'delete');});res.status(204).end();}));
 admin.put('/brands/:brandId/stores/:storeId/items/:itemId/override',wrap(async(req,res)=>json(res)(await brandWrite(req,async(tx,b)=>{const a=await assignment(req,tx);const p=await tx.product.findFirst({where:{id:req.params.itemId,brandId:b.id}});if(!p)fail(404,'Product not found.');const data={};if(req.body.priceAmount!==undefined)data.priceAmount=money(req.body.priceAmount,true);if(req.body.isSoldOut!==undefined)data.isSoldOut=req.body.isSoldOut===null?null:bool(req.body.isSoldOut,'Sold out');if(req.body.unavailableOptionIds!==undefined){const optionIds=new Set([...(p.sizes||[]).map(size=>size.id),...(p.addOnGroups||[]).flatMap(group=>group.options.map(option=>option.id))]);data.unavailableOptionIds=normalizeUnavailableOptionIds(req.body.unavailableOptionIds,optionIds);}const result=await tx.productStoreOverride.upsert({where:{storeBrandId_productId:{storeBrandId:a.id,productId:p.id}},create:{storeBrandId:a.id,productId:p.id,brandId:b.id,...data},update:data});await record(tx,req,b,'ProductStoreOverride',result.id,'update',{...data,storeId:a.storeId});return result;},req.params.storeId))));
 admin.get('/brands/:brandId/stores/:storeId/preview',wrap(async(req,res)=>{const a=await assignment(req);json(res)(await resolveMenu(db,a.id));}));
 admin.post('/brands/:brandId/stores/:storeId/publish',wrap(async(req,res)=>{await assignment(req);json(res)(await publish(db,req.admin,req.params.brandId,[req.params.storeId]));}));
 admin.post('/brands/:brandId/publish',wrap(async(req,res)=>{await brand(req);const ids=req.body.storeIds;if(ids!==undefined && (!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string')))fail(400,'Select one or more stores.');json(res)(await publish(db,req.admin,req.params.brandId,ids));}));
 admin.get('/brands/:brandId/audit-log',wrap(async(req,res)=>{await brand(req);json(res)(await db.auditLog.findMany({where:{brandId:req.params.brandId},orderBy:{at:'desc'},take:100}));}));
 admin.get('/orgs/:orgId/audit-log',wrap(async(req,res)=>{await org(req);json(res)(await db.auditLog.findMany({where:{orgId:req.params.orgId,brandId:null},orderBy:{at:'desc'},take:100}));}));
 admin.get('/orgs/:orgId/memberships',wrap(async(req,res)=>{await org(req);json(res)(await db.orgMembership.findMany({where:{orgId:req.params.orgId},include:{profile:{select:{id:true,email:true,supabaseUserId:true,status:true}}}}));}));
 admin.post('/orgs/:orgId/memberships',wrap(async(req,res)=>{await org(req);const email=text(req.body.email,'Email',200).toLowerCase();if(!/^[^@\s]+@[^@\s]+[.][^@\s]+$/.test(email))fail(400,'Enter a valid administrator email');const result=await db.$transaction(async tx=>{const p=await tx.adminProfile.upsert({where:{email},create:{email},update:{}});const m=await tx.orgMembership.upsert({where:{profileId_orgId:{profileId:p.id,orgId:req.params.orgId}},create:{profileId:p.id,orgId:req.params.orgId},update:{}});await audit(tx,req.admin,{orgId:req.params.orgId},'OrgMembership',m.id,'grant');return m;});res.status(201).json({success:true,data:result});}));
 admin.delete('/orgs/:orgId/memberships/:id',wrap(async(req,res)=>{await org(req);await db.$transaction(async tx=>{const m=await tx.orgMembership.findFirst({where:{id:req.params.id,orgId:req.params.orgId}});if(!m)fail(404,'Membership not found.');if(m.profileId===req.admin.id && !req.admin.isPlatformAdmin)fail(409,'Another organization administrator must remove your membership.');await tx.orgMembership.delete({where:{id:m.id}});await audit(tx,req.admin,{orgId:m.orgId},'OrgMembership',m.id,'revoke');});res.status(204).end();}));
 admin.post('/brands/:brandId/uploads/sign',wrap(async(req,res)=>{const b=await brand(req);const cloudName=process.env.CLOUDINARY_CLOUD_NAME,apiKey=process.env.CLOUDINARY_API_KEY,apiSecret=process.env.CLOUDINARY_API_SECRET;if(!cloudName||!apiKey||!apiSecret)fail(503,'Image storage is not configured.');const timestamp=Math.round(Date.now()/1000),folder='menu-platform/'+b.id;const signature=crypto.createHash('sha256').update('folder='+folder+'&timestamp='+timestamp+apiSecret).digest('hex');await record(db,req,b,'Asset',b.id,'sign-upload');json(res)({cloudName,apiKey,timestamp,folder,signature,signature_algorithm:'sha256'});}));
 admin.post('/brands/:brandId/assets',wrap(async(req,res)=>{const b=await brand(req),publicId=text(req.body.publicId,'Public image ID',500);if(!publicId.startsWith('menu-platform/'+b.id+'/'))fail(403,'Image belongs to another brand.');let resource;try{resource=await cloudinary.api.resource(publicId,{resource_type:'image'});}catch{fail(400,'Uploaded image could not be verified.');}if(resource.public_id!==publicId)fail(400,'Invalid uploaded image.');json(res)(await db.$transaction(async tx=>{const asset=await tx.asset.upsert({where:{publicId},create:{brandId:b.id,publicId,url:resource.secure_url},update:{url:resource.secure_url}});await record(tx,req,b,'Asset',asset.id,'register');return asset;}));}));
 return router;
}
module.exports={createRouter};
