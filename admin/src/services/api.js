import axios from 'axios';
import { supabase } from '../supabase';
const API_URL=process.env.REACT_APP_API_URL || (process.env.NODE_ENV==='production' ? null : 'http://localhost:5001/api');
if(!API_URL)throw new Error('REACT_APP_API_URL is required in production.');
const api=axios.create({baseURL:API_URL,timeout:20000});
let sessionRefreshPromise;
api.interceptors.request.use(async config=>{
 if(supabase){const {data,error}=await supabase.auth.getSession();if(error)throw error;if(data.session?.access_token)config.headers.Authorization='Bearer '+data.session.access_token;}
 return config;
});
api.interceptors.response.use(response=>response,async error=>{
 const config=error.config;
 if(error.response?.status===401&&supabase&&config&&!config.adminAuthRetried){
  config.adminAuthRetried=true;
  try{
   sessionRefreshPromise ||= supabase.auth.refreshSession()
    .then(({data, error:refreshError})=>{
     if(refreshError)throw refreshError;
     if(!data.session?.access_token)throw new Error('Your sign-in has expired.');
     return data.session;
    })
    .finally(()=>{sessionRefreshPromise=undefined;});
   const session=await sessionRefreshPromise;
   config.headers={...config.headers,Authorization:'Bearer '+session.access_token};
   return api.request(config);
  }catch(refreshError){
   return Promise.reject({error:refreshError.message||'Your sign-in has expired. Please sign in again.'});
  }
 }
 return Promise.reject(error.response?.data || {error:error.message});
});
export const authService={
 getCurrentUser:async()=> (await api.get('/admin/me')).data.data,
 getBootstrap:async()=> (await api.get('/admin/bootstrap')).data.data
};
const formatted=(amount,currency)=>(currency==='EUR'?'€':currency+' ')+Number(amount).toFixed(2);
const mapCategory=c=>({...c,_id:c.id,dbId:c.id,id:c.code,order:c.sortOrder,parentId:c.parentId,parent:c.parent, count:c._count?.products??0});
const mapProduct=p=>({...p,_id:p.id,dbId:p.id,title:p.name,category:p.category?.code||p.legacyCategoryCode,image:p.imageUrl,price:formatted(p.priceAmount,p.currency),available:p.isActive});
export function createCatalogServices(brand){
 const prefix='/admin/brands/'+encodeURIComponent(brand.id);
 async function upload(file){
  const creds=(await api.post(prefix+'/uploads/sign')).data.data;
  const data=new FormData();for(const key of ['api_key','timestamp','signature','folder'])data.append(key,key==='api_key'?creds.apiKey:creds[key]);data.append('file',file);
  const response=await axios.post('https://api.cloudinary.com/v1_1/'+creds.cloudName+'/image/upload',data,{timeout:120000});
  const asset=(await api.post(prefix+'/assets',{publicId:response.data.public_id})).data.data;
  return {imageUrl:asset.url,imagePublicId:asset.publicId};
 }
 async function payload({fields,file}){
  const data={name:fields.title,categoryCode:fields.category,description:fields.description,ingredients:fields.ingredients,
   priceAmount:String(fields.price).replace(/^(?:[A-Z]{3}|€|\u20c3)\s*/,''),isActive:fields.available,
   sizes:fields.sizes||[],addOnGroups:fields.addOnGroups||[]};
  if(file)Object.assign(data,await upload(file));
  return data;
 }
 return {
  productService:{
   getAllProducts:async()=>({data:(await api.get(prefix+'/items')).data.data.map(mapProduct)}),
   createProduct:async data=>({data:mapProduct((await api.post(prefix+'/items',await payload(data))).data.data)}),
   updateProduct:async(id,data)=>({data:mapProduct((await api.put(prefix+'/items/'+encodeURIComponent(id),await payload(data))).data.data)}),
   toggleAvailability:async(id,isActive)=>({data:mapProduct((await api.put(prefix+'/items/'+encodeURIComponent(id),{isActive})).data.data)}),
   deleteProduct:async id=>api.delete(prefix+'/items/'+encodeURIComponent(id))
  },
  categoryService:{
   getAllCategories:async()=> (await api.get(prefix+'/categories')).data.data.map(mapCategory),
   createCategory:async data=>({data:mapCategory((await api.post(prefix+'/categories',{code:data.id,name:data.name,icon:data.icon,sortOrder:data.order,parentId:data.parentId||null})).data.data)}),
   updateCategory:async(id,data)=>({data:mapCategory((await api.put(prefix+'/categories/'+encodeURIComponent(id),{code:data.id,name:data.name,icon:data.icon,sortOrder:data.order,parentId:data.parentId||null})).data.data)}),
   deleteCategory:async id=>api.delete(prefix+'/categories/'+encodeURIComponent(id))
  }
 };
}
export const platformService={
 get:async path=>(await api.get('/admin'+path)).data.data,
 post:async(path,data)=>(await api.post('/admin'+path,data)).data?.data,
 put:async(path,data)=>(await api.put('/admin'+path,data)).data?.data,
 remove:async path=>api.delete('/admin'+path)
};
export default api;
