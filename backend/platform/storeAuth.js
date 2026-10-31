const crypto=require('crypto');
const jwt=require('jsonwebtoken');
const argon2=require('argon2');
const {Problem,fail}=require('./http');
const {tokenOf}=require('./auth');
const options={type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1};
const STORE_SESSION_DAYS=90;
const hash=value=>argon2.hash(value,options);
const dummy=hash('dummy-store-password-for-unknown-identifiers');
const verify=async (encoded,value)=>{try{return await argon2.verify(encoded,value);}catch{return false;}};
function key(){const k=process.env.STORE_JWT_SECRET;if(!k || Buffer.byteLength(k)<32)fail(503,'Store authentication is not configured.');return k;}
function sign(store,session){return jwt.sign({realm:'store',storeId:store.id,orgId:store.orgId,sessionId:session.id,tokenVersion:store.tokenVersion},key(),{algorithm:'HS256',audience:'store',issuer:'ilmio-store',expiresIn:'15m'});}
const newRefresh=id=>id+'.'+crypto.randomBytes(48).toString('base64url');
const qrTokenHash=value=>crypto.createHash('sha256').update(value).digest('hex');
function validLoginCode(value){return typeof value==='string'&&/^[a-z0-9][a-z0-9-]{2,39}$/.test(value);}
function validQrToken(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);}
async function lock(db,value){await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${value}))`;}
async function authenticate(db,body,ip,createSession) {
  key();
  const identifier=typeof body.loginCode==='string'?body.loginCode.trim().toLowerCase().slice(0,100):'';
  const password=typeof body.password==='string' && body.password.length<=1024?body.password:'';
  const result=await db.$transaction(async tx=>{
    // A fixed ordering prevents deadlocks between code/IP lock pairs.
    for(const k of ['code:'+identifier,'ip:'+ip].sort())await lock(tx,k);
    const since=new Date(Date.now()-15*60*1000);
    const store=await tx.store.findUnique({where:{loginCode:identifier},include:{org:true}});
    if(store?.lockedUntil && store.lockedUntil>new Date())return {retry:Math.ceil((store.lockedUntil-Date.now())/1000)};
    const failures=await tx.loginAttempt.count({where:{realm:'store',success:false,at:{gte:since},OR:[{identifier},{ip}]}});
    if(failures>=5){
      // Count windows independently; OR count would over-throttle unrelated pairs.
      const [byCode,byIp]=await Promise.all([tx.loginAttempt.count({where:{realm:'store',identifier,success:false,at:{gte:since}}}),tx.loginAttempt.count({where:{realm:'store',ip,success:false,at:{gte:since}}})]);
      if(byCode>=5 || byIp>=5)return {retry:900};
    }
    const hasHash=store?.passwordHash?.startsWith('$argon2id$');
    const compared=await verify(hasHash ? store.passwordHash : await dummy,password);
    const valid=Boolean(hasHash && compared);
    if(!store || !valid || store.status!=='active' || store.org.status!=='active'){
      await tx.loginAttempt.create({data:{realm:'store',identifier,ip,success:false}});
      if(store){const attempts=store.failedLogins+1;await tx.store.update({where:{id:store.id},data:{failedLogins:attempts>=10?0:attempts,lockedUntil:attempts>=10?new Date(Date.now()+30*60*1000):null}});}
      return {invalid:true};
    }
    await tx.loginAttempt.create({data:{realm:'store',identifier,ip,success:true}});
    await tx.store.update({where:{id:store.id},data:{lastLoginAt:new Date(),failedLogins:0,lockedUntil:null}});
    if(!createSession)return {verified:true};
    const id=crypto.randomUUID(),refreshToken=newRefresh(id);
    const session=await tx.storeSession.create({data:{id,storeId:store.id,tokenVersion:store.tokenVersion,refreshHash:await hash(refreshToken),expiresAt:new Date(Date.now()+STORE_SESSION_DAYS*86400000),deviceLabel:typeof body.deviceLabel==='string'?body.deviceLabel.slice(0,100):null}});
    return {accessToken:sign(store,session),refreshToken,store:{id:store.id,name:store.name,orgId:store.orgId}};
  },{timeout:20000});
  if(result.retry)throw new Problem(429,'Too many attempts. Try again later.',result.retry);
  if(result.invalid)fail(401,'Invalid store ID or password.');
  return result;
}
const login=(db,body,ip)=>authenticate(db,body,ip,true);
const verifyPassword=(db,body,ip)=>authenticate(db,body,ip,false);
async function loginWithQr(db,body){
  key();
  const identifier=body?.loginCode;
  const token=body?.token;
  if(!validLoginCode(identifier)||!validQrToken(token))fail(401,'Invalid or expired store login QR.');
  const now=new Date(),hashValue=qrTokenHash(token);
  const result=await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "StoreLoginQrToken" WHERE "tokenHash" = ${hashValue} FOR UPDATE`;
    const qr=await tx.storeLoginQrToken.findUnique({where:{tokenHash:hashValue},include:{store:{include:{org:true}}}});
    if(!qr||qr.store.loginCode!==identifier||qr.consumedAt||qr.expiresAt<=now)fail(401,'Invalid or expired store login QR.');
    const consumed=await tx.storeLoginQrToken.updateMany({where:{id:qr.id,consumedAt:null,expiresAt:{gt:now}},data:{consumedAt:now}});
    if(consumed.count!==1)fail(401,'Invalid or expired store login QR.');
    if(qr.store.status!=='active'||qr.store.org.status!=='active')return {invalid:true};
    await tx.store.update({where:{id:qr.store.id},data:{lastLoginAt:now,failedLogins:0,lockedUntil:null}});
    const id=crypto.randomUUID(),refreshToken=newRefresh(id);
    const session=await tx.storeSession.create({data:{id,storeId:qr.store.id,tokenVersion:qr.store.tokenVersion,refreshHash:await hash(refreshToken),expiresAt:new Date(now.getTime()+STORE_SESSION_DAYS*86400000),deviceLabel:'Store tablet'}});
    return {accessToken:sign(qr.store,session),refreshToken,store:{id:qr.store.id,name:qr.store.name,orgId:qr.store.orgId},loginCode:identifier};
  },{timeout:20000});
  if(result.invalid)fail(401,'Invalid or expired store login QR.');
  return result;
}
async function refresh(db,value) {
  key();
  if(typeof value!=='string' || value.length>512 || !/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{64}$/.test(value))fail(401,'Invalid store session.');
  const id=value.split('.')[0];
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "StoreSession" WHERE "id" = ${id} FOR UPDATE`;
    const session=await tx.storeSession.findUnique({where:{id},include:{store:{include:{org:true}}}});
    if(!session || session.revokedAt || session.expiresAt<=new Date() || session.store.status!=='active' || session.store.org.status!=='active' || session.tokenVersion!==session.store.tokenVersion || !await verify(session.refreshHash,value))fail(401,'Invalid store session.');
    const refreshToken=newRefresh(id);
    await tx.storeSession.update({where:{id},data:{refreshHash:await hash(refreshToken),lastSeenAt:new Date()}});
    return {accessToken:sign(session.store,session),refreshToken};
  },{timeout:15000});
}
function createStoreAuth(db) {
  return async (req,res,next)=>{
    res.set('Cache-Control','private, no-cache');
    const token=tokenOf(req);
    const decoded=jwt.decode(token);
    if(decoded && (decoded.realm!=='store' || decoded.aud!=='store'))fail(403,'A store session is required.');
    let claims;try{claims=jwt.verify(token,key(),{algorithms:['HS256'],audience:'store',issuer:'ilmio-store'});}catch(error){if(error instanceof Problem)throw error;fail(401,'Invalid store session.');}
    if(claims.realm!=='store' || typeof claims.sessionId!=='string')fail(401,'Invalid store session.');
    const session=await db.storeSession.findUnique({where:{id:claims.sessionId},include:{store:{include:{org:true}}}});
    if(!session || session.revokedAt || session.expiresAt<=new Date() || session.storeId!==claims.storeId || session.store.orgId!==claims.orgId || session.tokenVersion!==claims.tokenVersion || session.store.tokenVersion!==claims.tokenVersion || session.store.status!=='active' || session.store.org.status!=='active')fail(401,'Store session is no longer valid.');
    const lastSeenBefore=new Date(Date.now()-60_000);
    if(session.lastSeenAt<lastSeenBefore)await db.storeSession.updateMany({where:{id:session.id,revokedAt:null,lastSeenAt:{lt:lastSeenBefore}},data:{lastSeenAt:new Date()}});
    req.store=session.store;req.storeSession=session;res.set('X-Store-Id',session.storeId);next();
  };
}
function password(value){if(typeof value!=='string'||value.length<6||value.length>1024)fail(400,'Password must contain 6–1024 characters.');return value;}
module.exports={hash,verify,password,login,verifyPassword,loginWithQr,qrTokenHash,refresh,createStoreAuth};
